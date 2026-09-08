/**
 * Domain-specific Jest matchers.
 *
 * The SRI-KO API answers with a consistent envelope
 * (`{ success, message, ... }`) and a small set of recurring shapes. Encoding
 * those shapes as matchers keeps assertions readable and — more usefully —
 * makes failure output say what was actually wrong instead of dumping a diff
 * of two large objects.
 *
 *   expect(response).toBeSuccessfulResponse(200);
 *   expect(response).toBeUnauthorised();
 *   expect(response).toBeForbidden();
 *   expect(response).toFailValidation('email');
 *   expect(body.user).not.toExposePassword();
 *   expect(token).toBeValidJwtFor(user._id);
 *   expect(hash).toBeBcryptHash();
 */

'use strict';

/** Compact, readable summary of a Supertest response for failure messages. */
function describeResponse(response) {
  if (!response || typeof response.status !== 'number') {
    return `not a Supertest response: ${JSON.stringify(response)}`;
  }
  const body = JSON.stringify(response.body);
  return `HTTP ${response.status} ${body.length > 400 ? `${body.slice(0, 400)}…` : body}`;
}

const matchers = {
  /** 2xx (or an exact status) with `success: true`. */
  toBeSuccessfulResponse(response, expectedStatus) {
    const statusOk =
      expectedStatus === undefined
        ? response.status >= 200 && response.status < 300
        : response.status === expectedStatus;
    const bodyOk = response.body && response.body.success !== false;
    const pass = statusOk && bodyOk;

    return {
      pass,
      message: () =>
        pass
          ? `Expected NOT a successful response, but received ${describeResponse(response)}`
          : `Expected ${expectedStatus ? `HTTP ${expectedStatus}` : 'a 2xx response'} with ` +
            `success !== false, but received ${describeResponse(response)}`,
    };
  },

  /** An error envelope: the given status and `success: false`. */
  toBeErrorResponse(response, expectedStatus, messagePattern) {
    const statusOk = response.status === expectedStatus;
    const shapeOk = response.body && response.body.success === false;
    const messageOk =
      messagePattern === undefined ||
      (typeof response.body?.message === 'string' &&
        (messagePattern instanceof RegExp
          ? messagePattern.test(response.body.message)
          : response.body.message.includes(messagePattern)));
    const pass = statusOk && shapeOk && messageOk;

    return {
      pass,
      message: () =>
        pass
          ? `Expected NOT an HTTP ${expectedStatus} error, but received ${describeResponse(response)}`
          : `Expected HTTP ${expectedStatus} with success:false` +
            `${messagePattern ? ` and message matching ${messagePattern}` : ''}, ` +
            `but received ${describeResponse(response)}`,
    };
  },

  /** 401 — authentication missing or invalid. */
  toBeUnauthorised(response) {
    const pass = response.status === 401 && response.body?.success === false;
    return {
      pass,
      message: () =>
        pass
          ? `Expected NOT 401, but received ${describeResponse(response)}`
          : `Expected HTTP 401 Unauthorised, but received ${describeResponse(response)}`,
    };
  },

  /** 403 — authenticated but not permitted. The A01 access-control assertion. */
  toBeForbidden(response) {
    const pass = response.status === 403 && response.body?.success === false;
    return {
      pass,
      message: () =>
        pass
          ? `Expected NOT 403, but received ${describeResponse(response)}`
          : `Expected HTTP 403 Forbidden, but received ${describeResponse(response)}`,
    };
  },

  toBeNotFound(response) {
    const pass = response.status === 404 && response.body?.success === false;
    return {
      pass,
      message: () =>
        pass
          ? `Expected NOT 404, but received ${describeResponse(response)}`
          : `Expected HTTP 404 Not Found, but received ${describeResponse(response)}`,
    };
  },

  /**
   * 400 from express-validator, optionally naming the field that failed.
   * `errors` is an array of `{ path|param, msg }`.
   */
  toFailValidation(response, field) {
    const statusOk = response.status === 400;
    const errors = response.body?.errors;
    const hasErrors = Array.isArray(errors) && errors.length > 0;
    const fieldOk =
      field === undefined ||
      (hasErrors && errors.some((error) => error.path === field || error.param === field));
    const pass = statusOk && hasErrors && fieldOk;

    return {
      pass,
      message: () =>
        pass
          ? `Expected NOT a validation failure${field ? ` on "${field}"` : ''}, ` +
            `but received ${describeResponse(response)}`
          : `Expected HTTP 400 with a non-empty errors array` +
            `${field ? ` naming "${field}"` : ''}, but received ${describeResponse(response)}`,
    };
  },

  /**
   * No password material anywhere in the object — checked recursively, because
   * a leak usually happens on a nested `user` or inside an array of documents.
   */
  toExposePassword(received) {
    const leaks = [];

    const walk = (node, trail) => {
      if (node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${trail}[${index}]`));
        return;
      }
      for (const [key, value] of Object.entries(node)) {
        const here = trail ? `${trail}.${key}` : key;
        if (/^(password|passwordHash|hashedPassword)$/i.test(key) && value !== undefined) {
          leaks.push(here);
        }
        walk(value, here);
      }
    };
    walk(received, '');

    return {
      pass: leaks.length > 0,
      message: () =>
        leaks.length > 0
          ? `Expected no password material, but found it at: ${leaks.join(', ')}`
          : 'Expected password material to be exposed, but none was found',
    };
  },

  /** A well-formed JWT whose `id` claim is the given user. */
  toBeValidJwtFor(token, userId) {
    if (typeof token !== 'string' || token.split('.').length !== 3) {
      return {
        pass: false,
        message: () =>
          `Expected a JWT (three dot-separated segments), received ${typeof token}: ${token}`,
      };
    }

    let payload;
    try {
      payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    } catch (error) {
      return { pass: false, message: () => `JWT payload is not valid JSON: ${error.message}` };
    }

    const pass = String(payload.id) === String(userId);
    return {
      pass,
      message: () =>
        pass
          ? `Expected the JWT NOT to be issued for ${userId}`
          : `Expected the JWT to carry id "${userId}", but its payload is ${JSON.stringify(payload)}`,
    };
  },

  /**
   * A bcrypt hash, and — per OWASP A02 — one with an adequate cost factor.
   * The default minimum of 12 is the value named in SENG 34213 §8.1.
   */
  toBeBcryptHash(received, minimumCost = 12) {
    const match = /^\$2[aby]\$(\d{2})\$[./A-Za-z0-9]{53}$/.exec(String(received));
    if (!match) {
      return {
        pass: false,
        message: () => `Expected a bcrypt hash, received ${JSON.stringify(received)}`,
      };
    }

    const cost = Number(match[1]);
    const pass = cost >= minimumCost;
    return {
      pass,
      message: () =>
        pass
          ? `Expected NOT a bcrypt hash with cost >= ${minimumCost} (cost is ${cost})`
          : `Expected a bcrypt cost factor of at least ${minimumCost}, but the hash uses ${cost}`,
    };
  },

  /** A 24-character hexadecimal Mongo ObjectId. */
  toBeObjectId(received) {
    const pass = /^[0-9a-f]{24}$/i.test(String(received));
    return {
      pass,
      message: () =>
        pass
          ? `Expected NOT an ObjectId, received ${received}`
          : `Expected a 24-character hex ObjectId, received ${JSON.stringify(received)}`,
    };
  },

  /** Within `toleranceMs` of now — for `createdAt`, `lastLogin`, `paidDate`. */
  toBeRecentTimestamp(received, toleranceMs = 10000) {
    const time = new Date(received).getTime();
    if (Number.isNaN(time)) {
      return {
        pass: false,
        message: () => `Expected a date, received ${JSON.stringify(received)}`,
      };
    }
    const drift = Math.abs(Date.now() - time);
    const pass = drift <= toleranceMs;
    return {
      pass,
      message: () =>
        pass
          ? `Expected ${received} NOT to be within ${toleranceMs} ms of now`
          : `Expected ${received} to be within ${toleranceMs} ms of now, but it is ${drift} ms away`,
    };
  },
};

expect.extend(matchers);

module.exports = matchers;
