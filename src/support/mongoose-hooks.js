/**
 * Run a schema's application-defined middleware without a database.
 *
 * Mongoose `pre('save')` hooks hold real business logic — password hashing,
 * certificate numbering, invoice numbering, completion dates — and §6.4 puts
 * those models in the critical-business-logic band at 90 % branch coverage.
 * Reaching branches like "the password was not modified" needs the hook invoked
 * directly; a round-trip through `save()` cannot control `isModified()`.
 *
 * Mongoose registers its own hooks alongside the application's
 * (`validateBeforeSave`, `timestampsPreSave`, …), and their number and order
 * change between releases, so indexing into the hook array is not safe. This
 * module identifies application hooks by *excluding* the internal ones by name
 * and asserts that at least one was found — if a Mongoose upgrade ever breaks
 * the assumption, the tests say so instead of silently passing.
 */

'use strict';

/**
 * Hooks Mongoose installs itself. All are named functions; application hooks in
 * this codebase are anonymous or named by the developer.
 */
const MONGOOSE_INTERNAL_HOOKS = new Set([
  'validateBeforeSave',
  'saveSubdocsPreSave',
  'timestampsPreSave',
  'shardingPluginPreSave',
  'trackTransactionPreSave',
  'saveSubdocsPostSave',
  'timestampsPostSave',
  '_setIsNew',
  'castArrayFilters',
]);

/**
 * Every application-defined `pre(<event>)` hook on a model's schema.
 *
 * @param {import('mongoose').Model} model
 * @param {string} [event='save']
 * @returns {Function[]}
 */
function applicationPreHooks(model, event = 'save') {
  const registered = model.schema.s.hooks._pres.get(event) || [];
  const hooks = registered
    .map((entry) => entry.fn)
    .filter((fn) => typeof fn === 'function' && !MONGOOSE_INTERNAL_HOOKS.has(fn.name));

  if (hooks.length === 0) {
    throw new Error(
      `No application-defined pre('${event}') hook found on ${model.modelName}. ` +
        'Either the model no longer declares one, or Mongoose has renamed its ' +
        'internal hooks and MONGOOSE_INTERNAL_HOOKS in ' +
        'src/support/mongoose-hooks.js needs updating.',
    );
  }
  return hooks;
}

/**
 * Run every application `pre(<event>)` hook against a document, in order,
 * exactly as Mongoose would — including honouring an early `next(error)`.
 *
 * @param {import('mongoose').Model} model
 * @param {import('mongoose').Document} document
 * @param {object}  [options]
 * @param {string}  [options.event='save']
 * @param {object}  [options.modified]  paths `isModified()` should report true
 *                                      for, e.g. `{ password: false }`
 * @param {boolean} [options.isNew]     value for `document.isNew`
 * @returns {Promise<import('mongoose').Document>} the mutated document
 */
async function runPreHooks(model, document, options = {}) {
  const { event = 'save', modified, isNew } = options;

  // An unsaved document reports every path as modified, which makes the
  // "nothing changed" branch unreachable. Stubbing gives the test control.
  if (modified !== undefined) {
    document.isModified = (path) =>
      path === undefined ? Object.values(modified).some(Boolean) : Boolean(modified[path]);
  }
  if (isNew !== undefined) {
    Object.defineProperty(document, 'isNew', { value: isNew, configurable: true, writable: true });
  }

  for (const hook of applicationPreHooks(model, event)) {
    // Sequential by definition: Mongoose runs pre hooks in order, and a later
    // hook may depend on what an earlier one wrote.
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve, reject) => {
      const next = (error) => (error ? reject(error) : resolve());
      const returned = hook.call(document, next);
      // A hook declared `async (next)` may also resolve without calling next;
      // awaiting its promise covers that shape too.
      if (returned && typeof returned.then === 'function') {
        returned.then(() => resolve(), reject);
      }
    });
  }

  return document;
}

module.exports = { runPreHooks, applicationPreHooks, MONGOOSE_INTERNAL_HOOKS };
