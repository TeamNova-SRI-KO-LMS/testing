#!/usr/bin/env node
/**
 * Build the API endpoint inventory from the application's source.
 *
 * SENG 34213 §6.4 requires that *every* API endpoint has at least one
 * integration test, and suggests tracking that by hand. This script derives the
 * list from the code instead, so a route added in a feature branch immediately
 * shows up as uncovered rather than being quietly forgotten.
 *
 * Two passes:
 *   1. `server.js`  — `app.use('<prefix>', …, <router>)` gives each router its
 *                     mount prefix, plus any routes declared on `app` directly.
 *   2. route files  — `router.<verb>('<path>', …)` gives the path within the
 *                     router, and the middleware named on the same statement
 *                     classify the endpoint as public / protected / admin.
 *
 * Output: reports/endpoint-inventory.json
 *
 *   npm run sut:endpoints
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { resolveSut, REPO_ROOT } = require('../src/support/sut');

const OUTPUT = path.join(REPO_ROOT, 'reports', 'endpoint-inventory.json');
const VERBS = ['get', 'post', 'put', 'patch', 'delete', 'all'];

/**
 * Match `router.get(` / `app.post(` and capture the verb plus everything up to
 * the end of the line, which is where the guard middleware are named.
 */
const ROUTE_DECLARATION = new RegExp(
  String.raw`^\s*(?:router|app)\.(${VERBS.join('|')})\(\s*(['"\`])([^'"\`]*)\2(.*)$`,
);

/** Match `app.use('<prefix>', …)` and capture the prefix and the tail. */
const MOUNT_DECLARATION = /^\s*app\.use\(\s*(['"`])([^'"`]*)\1(.*)$/;

function readLines(filePath) {
  return fs.readFileSync(filePath, 'utf8').split('\n');
}

/**
 * Remove string and template literals and line comments, so brackets inside
 * them are not counted. `console.log('done :)')` would otherwise close a call
 * that is still open.
 */
function stripLiterals(line) {
  return line
    .replace(/\\./g, '') // escaped characters first, so \' does not end a string
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""')
    .replace(/`[^`]*`/g, '``')
    .replace(/\/\/.*$/, '');
}

/** Net change in parenthesis depth contributed by a line of code. */
function parenDelta(line) {
  const code = stripLiterals(line);
  return (code.match(/\(/g) || []).length - (code.match(/\)/g) || []).length;
}

/**
 * Classify an endpoint's access level from the middleware named on its
 * declaration line.
 */
function classify(tail) {
  if (/authorize\(\s*['"`]admin['"`]/.test(tail)) return 'admin';
  if (/authorize\(/.test(tail)) return 'role-restricted';
  if (/\bprotect\b/.test(tail)) return 'protected';
  return 'public';
}

/** The roles named inside `authorize(...)` on a declaration line. */
function rolesFrom(tail) {
  const match = /authorize\(([^)]*)\)/.exec(tail);
  if (!match) return [];
  return [...match[1].matchAll(/['"`]([a-z]+)['"`]/g)].map((m) => m[1]);
}

/** Normalise a mount prefix + route path into one comparable path. */
function joinPath(prefix, routePath) {
  const combined = `${prefix}${routePath}`.replace(/\/{2,}/g, '/');
  return combined.length > 1 ? combined.replace(/\/$/, '') : combined;
}

/**
 * Pass 1 — read `server.js` for router mount points and app-level routes.
 *
 * @returns {{mounts: Array<{prefix:string, routerVar:string}>,
 *            appRoutes: Array<object>}}
 */
function parseServer(backendDir) {
  const serverPath = path.join(backendDir, 'server.js');
  const lines = readLines(serverPath);

  // `const authRoutes = require('./routes/authRoutes');`
  const requiresByVar = new Map();
  for (const line of lines) {
    const match = /^\s*const\s+(\w+)\s*=\s*require\(\s*['"`]\.\/routes\/([\w./-]+)['"`]\s*\)/.exec(
      line,
    );
    if (match) requiresByVar.set(match[1], match[2].replace(/\.js$/, ''));
  }

  const mounts = [];
  const appRoutes = [];

  lines.forEach((line, index) => {
    const mount = MOUNT_DECLARATION.exec(line);
    if (mount) {
      const [, , prefix, sameLineTail] = mount;

      // Several mounts interpose an inline audit-logging middleware and span
      // many lines before naming the router:
      //   app.use('/api/auth', (req, res, next) => { … }, checkDatabase, authRoutes);
      // Reading only the first line would silently drop those routers — and a
      // dropped router is an entire API surface excluded from the coverage
      // gate — so the statement is read to the `)` that closes `app.use(`.
      //
      // Stopping at the first `);` is not good enough: the inline middleware
      // contains `console.log(…);` calls that would end the scan far too early.
      let tail = sameLineTail;
      let depth = 1 + parenDelta(sameLineTail); // 1 for the `app.use(` already consumed

      for (let i = index + 1; i < lines.length && depth > 0; i += 1) {
        tail += ` ${lines[i]}`;
        depth += parenDelta(lines[i]);
        if (i - index > 60) break; // Defensive: never run away on a malformed file.
      }

      // `app.use('/uploads', express.static(...))` names no router at all.
      for (const [variable, file] of requiresByVar) {
        if (new RegExp(String.raw`\b${variable}\b`).test(tail)) {
          mounts.push({ prefix, routerVar: variable, routerFile: file, line: index + 1 });
        }
      }
      return;
    }

    const route = ROUTE_DECLARATION.exec(line);
    if (route && /^\s*app\./.test(line)) {
      const [, method, , routePath, tail] = route;
      appRoutes.push({
        method: method.toUpperCase(),
        path: joinPath('', routePath),
        access: classify(tail),
        roles: rolesFrom(tail),
        source: 'server.js',
        line: index + 1,
      });
    }
  });

  return { mounts, appRoutes };
}

/**
 * Collect the full text of a call statement that begins on `startIndex`, by
 * following parenthesis depth until the opening call closes.
 */
function readStatement(lines, startIndex, openParenColumn) {
  let text = lines[startIndex].slice(openParenColumn + 1);
  let depth = 1 + parenDelta(text);

  for (let i = startIndex + 1; i < lines.length && depth > 0; i += 1) {
    text += `\n${lines[i]}`;
    depth += parenDelta(lines[i]);
    if (i - startIndex > 400) break; // Defensive ceiling for a malformed file.
  }
  return text;
}

/**
 * The portion of a route declaration that lists middleware, i.e. everything
 * before the request handler begins. Classifying on the full statement would
 * misread words appearing inside the handler body.
 */
function middlewareSection(statement) {
  const handlerStart = statement.search(/(?:async\s*)?(?:\(\s*req\b|function\s*\(\s*req\b)/);
  return handlerStart === -1 ? statement : statement.slice(0, handlerStart);
}

/** Pass 2 — read one route file for its `router.<verb>` declarations. */
function parseRouter(backendDir, routerFile, prefix) {
  const routerPath = path.join(backendDir, 'routes', `${routerFile}.js`);
  if (!fs.existsSync(routerPath)) return [];

  const lines = readLines(routerPath);
  const endpoints = [];
  const declaration = new RegExp(String.raw`^\s*router\.(${VERBS.join('|')})\s*\(`);

  lines.forEach((line, index) => {
    const match = declaration.exec(line);
    if (!match) return;

    // Long declarations put the path on its own line:
    //   router.post(
    //     '/register',
    //     validateUserRegistration,
    //     handleValidationErrors,
    //     async (req, res) => { … }
    // so the whole statement is read before the path is extracted, rather than
    // assuming everything sits on the opening line.
    const statement = readStatement(lines, index, line.indexOf('(', match[0].length - 1));
    const pathMatch = /['"`]([^'"`]*)['"`]/.exec(statement);
    if (!pathMatch) return;

    endpoints.push({
      method: match[1].toUpperCase(),
      path: joinPath(prefix, pathMatch[1]),
      access: classify(middlewareSection(statement)),
      roles: rolesFrom(middlewareSection(statement)),
      source: `routes/${routerFile}.js`,
      line: index + 1,
    });
  });

  return endpoints;
}

function extract() {
  const { backendDir } = resolveSut();
  const { mounts, appRoutes } = parseServer(backendDir);

  const endpoints = [...appRoutes];
  const seenRouters = new Set();

  for (const mount of mounts) {
    // A router mounted at several prefixes (the application also mounts the
    // admin router under a Choreo-specific prefix) yields one entry per prefix;
    // both are real, reachable endpoints.
    endpoints.push(...parseRouter(backendDir, mount.routerFile, mount.prefix));
    seenRouters.add(mount.routerFile);
  }

  // De-duplicate: `/api/admin/settings` is mounted after `/api/admin`, so a few
  // paths are produced twice with the same verb.
  const unique = new Map();
  for (const endpoint of endpoints) {
    const key = `${endpoint.method} ${endpoint.path}`;
    if (!unique.has(key)) {
      unique.set(key, {
        key,
        ...endpoint,
        // The application also mounts the admin router — and a handful of
        // health/test routes — under a Choreo deployment prefix that rewrites
        // to the same handlers. They are real, reachable endpoints, but they
        // are aliases of routes already covered under /api, so the endpoint
        // gate reports them separately instead of demanding a duplicate test
        // for each. `tests/integration/api/system/choreo-alias.test.js` proves
        // the prefix itself works.
        alias: endpoint.path.startsWith('/choreo-apis/'),
        // The Express 5 catch-all is a handler, not an addressable endpoint.
        catchAll: endpoint.path.includes('*'),
      });
    }
  }

  const list = [...unique.values()].sort((a, b) => a.key.localeCompare(b.key));

  const byAccess = list.reduce((totals, endpoint) => {
    totals[endpoint.access] = (totals[endpoint.access] || 0) + 1;
    return totals;
  }, {});

  /** Endpoints the 100 % coverage gate actually applies to. */
  const testable = list.filter((endpoint) => !endpoint.alias && !endpoint.catchAll);

  return {
    generatedAt: new Date().toISOString(),
    backendDir,
    routersFound: [...seenRouters].sort(),
    summary: {
      total: list.length,
      testable: testable.length,
      aliases: list.filter((e) => e.alias).length,
      catchAll: list.filter((e) => e.catchAll).length,
      byAccess,
    },
    endpoints: list,
  };
}

function main() {
  const inventory = extract();
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(inventory, null, 2)}\n`);

  process.stdout.write(
    `✓ ${inventory.summary.total} endpoints across ${inventory.routersFound.length} routers ` +
      `(${inventory.summary.testable} subject to the coverage gate, ` +
      `${inventory.summary.aliases} Choreo aliases, ${inventory.summary.catchAll} catch-all)\n`,
  );
  for (const [access, count] of Object.entries(inventory.summary.byAccess).sort()) {
    process.stdout.write(`    ${String(count).padStart(4)}  ${access}\n`);
  }
  process.stdout.write(`  → ${path.relative(REPO_ROOT, OUTPUT)}\n`);
}

if (require.main === module) main();

module.exports = { extract, joinPath, classify, rolesFrom };
