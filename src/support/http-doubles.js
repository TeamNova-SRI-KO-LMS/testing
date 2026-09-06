/**
 * Express request/response doubles for middleware unit tests.
 *
 * Middleware is the one part of an Express application that is genuinely unit
 * testable: it is a pure `(req, res, next)` function. Driving it through HTTP
 * would make the test an integration test and hide which branch actually ran.
 *
 *   const req = mockRequest({ headers: { authorization: 'Bearer x' } });
 *   const res = mockResponse();
 *   const next = jest.fn();
 *
 *   await protect(req, res, next);
 *
 *   expect(res.status).toHaveBeenCalledWith(401);
 *   expect(next).not.toHaveBeenCalled();
 */

'use strict';

/**
 * A request double. Header lookup is case-insensitive, matching Express.
 *
 * @param {object} [overrides] any request property: body, params, query, user…
 */
function mockRequest(overrides = {}) {
  const headers = {};
  for (const [key, value] of Object.entries(overrides.headers || {})) {
    headers[key.toLowerCase()] = value;
  }

  const request = {
    headers,
    body: {},
    params: {},
    query: {},
    cookies: {},
    method: 'GET',
    path: '/',
    originalUrl: '/',
    url: '/',
    ip: '127.0.0.1',
    get: (name) => headers[String(name).toLowerCase()],
    header: (name) => headers[String(name).toLowerCase()],
    ...overrides,
  };
  request.headers = headers;
  return request;
}

/**
 * A response double. `status`, `json`, `send`, `setHeader`, `removeHeader`,
 * `sendFile`, `end` and `on` are all jest mocks; `status` and the header
 * setters return `res` so real chaining works.
 *
 * Convenience accessors — `statusCode`, `body`, `headers` — read back what the
 * middleware produced, so assertions can be about the outcome rather than
 * about which mock was called in which order.
 */
function mockResponse() {
  const response = {};
  const headers = {};

  response.locals = {};
  response.headersSent = false;

  response.status = jest.fn((code) => {
    response.statusCode = code;
    return response;
  });
  response.json = jest.fn((payload) => {
    response.body = payload;
    response.headersSent = true;
    return response;
  });
  response.send = jest.fn((payload) => {
    response.body = payload;
    response.headersSent = true;
    return response;
  });
  response.sendFile = jest.fn(() => response);
  response.end = jest.fn(() => {
    response.headersSent = true;
    return response;
  });
  response.setHeader = jest.fn((name, value) => {
    headers[String(name).toLowerCase()] = value;
    return response;
  });
  response.getHeader = jest.fn((name) => headers[String(name).toLowerCase()]);
  response.removeHeader = jest.fn((name) => {
    delete headers[String(name).toLowerCase()];
    return response;
  });
  response.set = response.setHeader;
  response.on = jest.fn(() => response);
  response.cookie = jest.fn(() => response);
  response.redirect = jest.fn(() => response);

  Object.defineProperty(response, 'headers', { get: () => ({ ...headers }) });

  return response;
}

/**
 * Run a middleware and resolve once it has either called `next` or written a
 * response. Removes the `await middleware(...)` / "did it call next yet?"
 * ambiguity for middleware that is async internally but not awaited.
 *
 * @returns {Promise<{next: jest.Mock, req: object, res: object,
 *                    nextError: Error|undefined}>}
 */
async function runMiddleware(middleware, req = mockRequest(), res = mockResponse()) {
  const next = jest.fn();
  await middleware(req, res, next);
  return {
    req,
    res,
    next,
    nextCalled: next.mock.calls.length > 0,
    nextError: next.mock.calls[0]?.[0],
  };
}

/**
 * Run an express-validator chain against a request and return the result.
 * Validator chains are arrays of middleware plus, sometimes, a trailing
 * handler; this runs only the validators and reports the errors they produced,
 * which is what a unit test of a rule set should assert on.
 *
 * @param {Array} chain    an exported validator array
 * @param {object} body    the request body to validate
 * @returns {Promise<{isEmpty: boolean, errors: Array, fields: string[]}>}
 */
async function runValidators(chain, body = {}) {
  const { validationResult } = require('express-validator');
  const req = mockRequest({ body });

  for (const validator of chain) {
    if (typeof validator.run === 'function') {
      // Sequential by definition: express-validator accumulates errors on the
      // request, so the chain must run in declaration order.
      // eslint-disable-next-line no-await-in-loop
      await validator.run(req);
    }
  }

  const result = validationResult(req);
  const errors = result.array();
  return {
    isEmpty: result.isEmpty(),
    errors,
    fields: errors.map((error) => error.path ?? error.param),
    messages: errors.map((error) => error.msg),
    /** True when at least one error was raised for the given field. */
    hasErrorOn(field) {
      return errors.some((error) => (error.path ?? error.param) === field);
    },
    /** The first message raised for a field, for message assertions. */
    messageFor(field) {
      return errors.find((error) => (error.path ?? error.param) === field)?.msg;
    },
  };
}

module.exports = { mockRequest, mockResponse, runMiddleware, runValidators };
