/**
 * Unit tests — models/Progress.js
 *
 * Requirements: FR-10 (Enrolment), FR-11 (Progress Tracking & Completion),
 * FR-15 (Certificate eligibility depends on completionDate).
 *
 * `completionDate` is the field the admin analytics and certificate-eligibility
 * queries filter on, so the hook that maintains it is high-value: a course
 * marked complete without a date is invisible to both.
 */

'use strict';

const { requireFromSut } = require('@support/sut');
const { runPreHooks } = require('@support/mongoose-hooks');
const { testCase } = require('@support/test-case');

const Progress = requireFromSut('./models/Progress');
const mongoose = requireFromSut('mongoose');

const anObjectId = () => new mongoose.Types.ObjectId();

const aProgress = (overrides = {}) =>
  new Progress({ student: anObjectId(), course: anObjectId(), ...overrides });

/** A course shape with a known lesson count, for calculateProgress. */
const courseWithLessons = (...lessonsPerWeek) => ({
  curriculum: lessonsPerWeek.map((count, index) => ({
    week: index + 1,
    lessons: Array.from({ length: count }, (_, i) => ({ title: `Lesson ${i}` })),
  })),
});

describe('models/Progress', () => {
  describe('schema validation', () => {
    it('accepts a record with a student and a course', () => {
      const progress = aProgress();

      expect(progress.validateSync()).toBeUndefined();
      expect(progress.currentWeek).toBe(1);
      expect(progress.overallProgress).toBe(0);
      expect(progress.timeSpent).toBe(0);
      expect(progress.isCompleted).toBe(false);
    });

    it.each(['student', 'course'])('rejects a record with no %s', (field) => {
      const progress = aProgress();
      progress[field] = undefined;

      expect(progress.validateSync().errors[field]).toBeDefined();
    });

    it.each([
      ['below zero', -1],
      ['above one hundred', 101],
    ])('rejects an overall progress %s', (_label, overallProgress) => {
      expect(aProgress({ overallProgress }).validateSync().errors.overallProgress).toBeDefined();
    });

    it.each([0, 50, 100])('accepts an overall progress of %s', (overallProgress) => {
      expect(aProgress({ overallProgress }).validateSync()).toBeUndefined();
    });

    testCase(
      {
        id: 'TC-FR-10-U04',
        name: 'A unique compound index prevents a student enrolling twice in one course',
        requirement: 'FR-10',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'None',
        input: 'Inspection of the Progress schema indexes',
        expected: 'A unique index exists on { student: 1, course: 1 }',
      },
      () => {
        // The enrolment route also checks for an existing record, but two
        // concurrent requests can both pass that check; the database index is
        // the only thing that actually prevents a duplicate.
        const compound = Progress.schema
          .indexes()
          .find(([fields]) => 'student' in fields && 'course' in fields);

        expect(compound).toBeDefined();
        expect(compound[0]).toEqual({ student: 1, course: 1 });
        expect(compound[1].unique).toBe(true);
      },
    );
  });

  describe('completion date (pre-save hook)', () => {
    testCase(
      {
        id: 'TC-FR-11-U01',
        name: 'Marking a course complete stamps the completion date automatically',
        requirement: 'FR-11',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'A progress record with isCompleted false and no completionDate',
        input: "isCompleted is set to true and the pre('save') hook runs",
        expected: 'completionDate is set to the current time',
      },
      async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-03-01T10:00:00.000Z'));
        const progress = aProgress({ isCompleted: true });

        await runPreHooks(Progress, progress, { modified: { isCompleted: true } });

        expect(progress.completionDate).toEqual(new Date('2026-03-01T10:00:00.000Z'));
      },
    );

    it('does not overwrite a completion date that was set explicitly', async () => {
      // Back-dating a completion is a legitimate admin correction, and the hook
      // must not silently undo it.
      const explicit = new Date('2026-01-15T08:00:00.000Z');
      const progress = aProgress({ isCompleted: true, completionDate: explicit });

      await runPreHooks(Progress, progress, { modified: { isCompleted: true } });

      expect(progress.completionDate).toEqual(explicit);
    });

    testCase(
      {
        id: 'TC-FR-11-U02',
        name: 'Reverting a completion clears the completion date',
        requirement: 'FR-11',
        type: 'Unit',
        priority: 'P2',
        preconditions: 'A completed progress record with a completionDate',
        input: "isCompleted is set back to false and the pre('save') hook runs",
        expected: 'completionDate is cleared, so analytics no longer count the completion',
      },
      async () => {
        const progress = aProgress({
          isCompleted: false,
          completionDate: new Date('2026-01-15T08:00:00.000Z'),
        });

        await runPreHooks(Progress, progress, { modified: { isCompleted: true } });

        expect(progress.completionDate).toBeUndefined();
      },
    );

    it('leaves an incomplete record without a completion date', async () => {
      const progress = aProgress({ isCompleted: false });

      await runPreHooks(Progress, progress, { modified: { isCompleted: false } });

      expect(progress.completionDate).toBeUndefined();
    });
  });

  describe('calculateProgress', () => {
    testCase(
      {
        id: 'TC-FR-11-U03',
        name: 'calculateProgress returns the percentage of lessons completed',
        requirement: 'FR-11',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'A course with 10 lessons across two weeks; 5 lessons completed',
        input: 'progress.calculateProgress(course)',
        expected: '50',
      },
      () => {
        const progress = aProgress();
        progress.completedLessons = Array.from({ length: 5 }, () => ({ lesson: anObjectId() }));

        expect(progress.calculateProgress(courseWithLessons(5, 5))).toBe(50);
      },
    );

    it.each([
      ['no lessons completed', 0, [4, 4], 0],
      ['every lesson completed', 8, [4, 4], 100],
      ['one of three completed, rounded', 1, [3], 33],
      ['two of three completed, rounded', 2, [3], 67],
      ['one of six completed, rounded', 1, [6], 17],
    ])('returns %s → %s%%', (_label, completed, lessonsPerWeek, expected) => {
      const progress = aProgress();
      progress.completedLessons = Array.from({ length: completed }, () => ({
        lesson: anObjectId(),
      }));

      expect(progress.calculateProgress(courseWithLessons(...lessonsPerWeek))).toBe(expected);
    });

    it('returns zero for a course with no lessons rather than dividing by zero', () => {
      const progress = aProgress();

      expect(progress.calculateProgress(courseWithLessons())).toBe(0);
      expect(progress.calculateProgress(courseWithLessons(0, 0))).toBe(0);
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['an object with no curriculum', {}],
    ])('returns zero when the course is %s', (_label, course) => {
      expect(aProgress().calculateProgress(course)).toBe(0);
    });

    it('can exceed nothing — completing more lessons than exist caps at the ratio', () => {
      // Defensive: if stale completedLessons outnumber the current curriculum,
      // the method returns >100 rather than clamping. Documented so a future
      // change to clamp is a deliberate decision, not an accident.
      const progress = aProgress();
      progress.completedLessons = Array.from({ length: 6 }, () => ({ lesson: anObjectId() }));

      expect(progress.calculateProgress(courseWithLessons(3))).toBe(200);
    });
  });
});
