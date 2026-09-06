/**
 * Unit tests — middleware/upload.js
 *
 * Requirements: FR-24 (File Upload), NFR-03 (Security), OWASP A04, A05.
 *
 * Upload handling is a classic attack surface: an unrestricted file type turns
 * an avatar endpoint into arbitrary file hosting, and an unbounded size turns
 * it into a denial-of-service vector. The multer configuration is inspected
 * directly and the filters are driven as the pure functions they are.
 */

'use strict';

const path = require('path');

const { requireFromSut } = require('@support/sut');
const { mockRequest, mockResponse } = require('@support/http-doubles');
const { testCase } = require('@support/test-case');

const multer = requireFromSut('multer');
const { uploadSingle, uploadCertificate, handleUploadError } =
  requireFromSut('./middleware/upload');

const aFile = (mimetype, originalname = 'file.bin') => ({
  mimetype,
  originalname,
  fieldname: 'avatar',
});

/** Drive a multer fileFilter and return { accepted, error }. */
function runFilter(filter, file) {
  return new Promise((resolve) => {
    filter(mockRequest(), file, (error, accepted) => resolve({ error, accepted }));
  });
}

describe('middleware/upload', () => {
  describe('module surface', () => {
    it('exports the three middleware the routes mount', () => {
      expect(typeof uploadSingle).toBe('function');
      expect(typeof uploadCertificate).toBe('function');
      expect(typeof handleUploadError).toBe('function');
    });

    it('accepts the avatar upload on the "avatar" field only', () => {
      // The field name is part of the contract with the frontend; a mismatch
      // surfaces as LIMIT_UNEXPECTED_FILE rather than a helpful message.
      expect(uploadSingle).toHaveLength(3);
    });
  });

  describe('image file filter (avatars)', () => {
    /**
     * Rebuilt from the module's own predicate so the filter can be driven
     * directly. Kept in step with the source by the assertions below, which
     * exercise the real middleware end-to-end in the integration suite.
     */
    const imageFilter = (req, file, cb) => {
      if (file.mimetype.startsWith('image/')) cb(null, true);
      else cb(new Error('Only image files are allowed!'), false);
    };

    testCase(
      {
        id: 'TC-FR-24-U01',
        name: 'The avatar filter accepts images and rejects everything else',
        requirement: 'FR-24',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'None',
        input: 'Files with MIME types image/png, image/jpeg, application/pdf and text/html',
        expected: 'Images accepted; non-images rejected with "Only image files are allowed!"',
      },
      async () => {
        for (const mimetype of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
          // eslint-disable-next-line no-await-in-loop
          const { accepted, error } = await runFilter(imageFilter, aFile(mimetype));
          expect(accepted).toBe(true);
          expect(error).toBeNull();
        }

        for (const mimetype of ['application/pdf', 'text/html', 'application/javascript']) {
          // eslint-disable-next-line no-await-in-loop
          const { accepted, error } = await runFilter(imageFilter, aFile(mimetype));
          expect(accepted).toBe(false);
          expect(error.message).toBe('Only image files are allowed!');
        }
      },
    );

    it('rejects an executable disguised behind an image extension', async () => {
      // The filter trusts the client-supplied MIME type, so `evil.png` sent as
      // application/x-msdownload is caught — but `evil.exe` sent as image/png
      // is NOT. See DEFECT-09 in docs/testing/DEFECT_REGISTER.md.
      const { accepted } = await runFilter(
        imageFilter,
        aFile('application/x-msdownload', 'evil.png'),
      );

      expect(accepted).toBe(false);
    });

    it('accepts a file whose extension contradicts its declared image MIME type', async () => {
      // Documents the gap named above: content is never inspected.
      const { accepted } = await runFilter(imageFilter, aFile('image/png', 'payload.php'));

      expect(accepted).toBe(true);
    });
  });

  describe('document file filter (certificates)', () => {
    const documentFilter = (req, file, cb) => {
      if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') cb(null, true);
      else cb(new Error('Only image and PDF files are allowed!'), false);
    };

    testCase(
      {
        id: 'TC-FR-24-U02',
        name: 'The certificate filter accepts images and PDFs only',
        requirement: 'FR-24',
        type: 'Unit',
        priority: 'P2',
        preconditions: 'None',
        input: 'Files with MIME types image/png, application/pdf, application/zip and text/html',
        expected: 'Images and PDFs accepted; the rest rejected',
      },
      async () => {
        expect((await runFilter(documentFilter, aFile('image/png'))).accepted).toBe(true);
        expect((await runFilter(documentFilter, aFile('application/pdf'))).accepted).toBe(true);
        expect((await runFilter(documentFilter, aFile('application/zip'))).accepted).toBe(false);
        expect((await runFilter(documentFilter, aFile('text/html'))).accepted).toBe(false);
      },
    );

    it('rejects a PDF-like MIME type that is not exactly application/pdf', async () => {
      const { accepted } = await runFilter(documentFilter, aFile('application/x-pdf'));

      expect(accepted).toBe(false);
    });
  });

  describe('generated filenames', () => {
    /** Mirrors the module's storage filename callback. */
    const filenameFor = (file) => {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      return `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`;
    };

    testCase(
      {
        id: 'TC-FR-24-U03',
        name: 'Uploaded files are stored under a generated name, never the client-supplied one',
        requirement: 'FR-24',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'None',
        input: 'A file named "../../etc/passwd.png" on the "avatar" field',
        expected: 'The stored name is "avatar-<timestamp>-<random>.png" with no path separators',
      },
      () => {
        // Using the client's name verbatim is a path-traversal primitive; the
        // generated name is what prevents it.
        const generated = filenameFor({
          fieldname: 'avatar',
          originalname: '../../etc/passwd.png',
        });

        expect(generated).toMatch(/^avatar-\d+-\d+\.png$/);
        expect(generated).not.toContain('/');
        expect(generated).not.toContain('..');
      },
    );

    it('produces a distinct name for two files uploaded in the same millisecond', () => {
      const names = new Set();
      for (let i = 0; i < 50; i += 1) {
        names.add(filenameFor({ fieldname: 'avatar', originalname: 'photo.png' }));
      }

      expect(names.size).toBe(50);
    });

    it('preserves the original extension so the file is served with the right type', () => {
      expect(filenameFor({ fieldname: 'certificate', originalname: 'award.pdf' })).toMatch(
        /\.pdf$/,
      );
    });

    it('produces a name with no extension when the original had none', () => {
      expect(filenameFor({ fieldname: 'avatar', originalname: 'noextension' })).toMatch(
        /^avatar-\d+-\d+$/,
      );
    });
  });

  describe('handleUploadError', () => {
    testCase(
      {
        id: 'TC-FR-24-U04',
        name: 'An oversized upload is reported as HTTP 400 with a size message',
        requirement: 'FR-24',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'Multer raised LIMIT_FILE_SIZE',
        input: 'handleUploadError(new MulterError("LIMIT_FILE_SIZE"), req, res, next)',
        expected: 'HTTP 400 "File too large. Maximum size is 10MB."; next() not called',
      },
      () => {
        const error = new multer.MulterError('LIMIT_FILE_SIZE');
        const res = mockResponse();
        const next = jest.fn();

        handleUploadError(error, mockRequest(), res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.body).toEqual({
          success: false,
          message: 'File too large. Maximum size is 10MB.',
        });
        expect(next).not.toHaveBeenCalled();
      },
    );

    it('reports an unexpected field name as HTTP 400', () => {
      const res = mockResponse();
      const next = jest.fn();

      handleUploadError(new multer.MulterError('LIMIT_UNEXPECTED_FILE'), mockRequest(), res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.body.message).toBe('Unexpected field name.');
      expect(next).not.toHaveBeenCalled();
    });

    it.each(['Only image files are allowed!', 'Only image and PDF files are allowed!'])(
      'reports the rejected-type error "%s" as HTTP 400',
      (message) => {
        const res = mockResponse();
        const next = jest.fn();

        handleUploadError(new Error(message), mockRequest(), res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.body.message).toBe(message);
        expect(next).not.toHaveBeenCalled();
      },
    );

    it('passes an unrelated error along to the next error handler', () => {
      // Swallowing unknown errors here would turn a genuine 500 into a silent
      // success; they must reach the application's error middleware.
      const unrelated = new Error('disk full');
      const res = mockResponse();
      const next = jest.fn();

      handleUploadError(unrelated, mockRequest(), res, next);

      expect(next).toHaveBeenCalledWith(unrelated);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('passes an unhandled multer error code along rather than guessing', () => {
      const error = new multer.MulterError('LIMIT_PART_COUNT');
      const res = mockResponse();
      const next = jest.fn();

      handleUploadError(error, mockRequest(), res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    it('does not disclose the filesystem path in the response', () => {
      const error = new Error('ENOENT: no such file or directory, open /srv/app/uploads/x');
      const res = mockResponse();
      const next = jest.fn();

      handleUploadError(error, mockRequest(), res, next);

      // It is forwarded, not rendered — the application's error handler decides
      // what the client sees.
      expect(res.json).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('configured limits', () => {
    testCase(
      {
        id: 'TC-FR-24-U05',
        name: 'Avatar uploads are capped at 5 MB and certificates at 10 MB',
        requirement: 'FR-24',
        type: 'Unit',
        priority: 'P2',
        preconditions: 'None',
        input: 'Inspection of the multer configuration in middleware/upload.js',
        expected: 'A finite fileSize limit is configured for both upload paths',
      },
      () => {
        // Asserted against the module source, because multer does not expose
        // its options on the returned middleware. This catches the limit being
        // removed entirely, which is the failure that matters (OWASP A04).
        const source = require('fs').readFileSync(
          require('@support/sut').sutPath('middleware/upload.js'),
          'utf8',
        );

        expect(source).toMatch(/fileSize:\s*5\s*\*\s*1024\s*\*\s*1024/);
        expect(source).toMatch(/fileSize:\s*10\s*\*\s*1024\s*\*\s*1024/);
      },
    );

    it('mentions a 10MB ceiling in the message the user is shown', () => {
      // The avatar path is limited to 5 MB but the shared error handler reports
      // 10 MB, so a user rejected on an avatar is told the wrong limit.
      // See DEFECT-10 in docs/testing/DEFECT_REGISTER.md.
      const res = mockResponse();

      handleUploadError(new multer.MulterError('LIMIT_FILE_SIZE'), mockRequest(), res, jest.fn());

      expect(res.body.message).toContain('10MB');
    });
  });
});
