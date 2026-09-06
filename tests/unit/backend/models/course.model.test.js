/**
 * Unit tests — models/Course.js
 *
 * Requirements: FR-09 (Course Authoring), FR-12 (Reviews & Ratings).
 *
 * The interesting logic here is the average-rating calculation in the pre-save
 * hook: it is the only derived value in the schema and it feeds course ranking
 * in the catalogue, so it is exercised at its boundaries.
 */

'use strict';

const { requireFromSut } = require('@support/sut');
const { runPreHooks } = require('@support/mongoose-hooks');
const { testCase } = require('@support/test-case');
const { buildCourse, buildCurriculumWeek, buildLesson } = require('@factories');

const Course = requireFromSut('./models/Course');
const mongoose = requireFromSut('mongoose');

const anObjectId = () => new mongoose.Types.ObjectId();

/** A course document with the required instructor reference already set. */
const aCourse = (overrides = {}) =>
  new Course({ ...buildCourse(overrides), instructor: overrides.instructor || anObjectId() });

describe('models/Course', () => {
  describe('schema validation', () => {
    testCase(
      {
        id: 'TC-FR-09-U02',
        name: 'A course built from valid attributes passes schema validation',
        requirement: 'FR-09',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'None',
        input: 'new Course({ title, description, instructor, category, level, duration, price })',
        expected:
          'validateSync() returns undefined; isPublished and averageRating take their defaults',
      },
      () => {
        const course = aCourse();

        expect(course.validateSync()).toBeUndefined();
        expect(course.averageRating).toBe(0);
        expect(course.enrolledStudents).toHaveLength(0);
        expect(course.reviews).toHaveLength(0);
      },
    );

    it.each(['title', 'description', 'instructor', 'category', 'level', 'duration', 'price'])(
      'rejects a course with no %s',
      (field) => {
        const course = aCourse();
        course[field] = undefined;

        expect(course.validateSync().errors[field]).toBeDefined();
      },
    );

    it('rejects a title longer than 100 characters', () => {
      const errors = aCourse({ title: 'a'.repeat(101) }).validateSync();

      expect(errors.errors.title.message).toBe('Course title cannot be more than 100 characters');
    });

    it('rejects a description longer than 1000 characters', () => {
      const errors = aCourse({ description: 'a'.repeat(1001) }).validateSync();

      expect(errors.errors.description).toBeDefined();
    });

    it('rejects a negative price but accepts zero', () => {
      expect(aCourse({ price: -1 }).validateSync().errors.price.message).toBe(
        'Price cannot be negative',
      );
      expect(aCourse({ price: 0 }).validateSync()).toBeUndefined();
    });

    it('rejects a category outside the enumeration', () => {
      expect(aCourse({ category: 'korean' }).validateSync().errors.category).toBeDefined();
    });

    it('rejects a level outside the enumeration', () => {
      expect(aCourse({ level: 'expert' }).validateSync().errors.level).toBeDefined();
    });

    it('requires every curriculum lesson to carry a title, content and duration', () => {
      const course = aCourse();
      course.curriculum = [buildCurriculumWeek({ lessons: [{ title: 'Only a title' }] })];

      const errors = course.validateSync();

      expect(errors.errors['curriculum.0.lessons.0.content']).toBeDefined();
      expect(errors.errors['curriculum.0.lessons.0.duration']).toBeDefined();
    });

    it('defaults a lesson to a video that is not a free preview', () => {
      const course = aCourse();
      course.curriculum = [buildCurriculumWeek({ lessons: [buildLesson({ type: undefined })] })];

      expect(course.curriculum[0].lessons[0].type).toBe('video');
      expect(course.curriculum[0].lessons[0].isFreePreview).toBe(false);
    });

    it('rejects a lesson type outside the enumeration', () => {
      const course = aCourse();
      course.curriculum = [buildCurriculumWeek({ lessons: [buildLesson({ type: 'podcast' })] })];

      expect(course.validateSync().errors['curriculum.0.lessons.0.type']).toBeDefined();
    });

    it('constrains a review rating to between one and five', () => {
      const course = aCourse();
      course.reviews = [{ user: anObjectId(), rating: 6 }];

      expect(course.validateSync().errors['reviews.0.rating']).toBeDefined();
    });

    it('trims whitespace from tags and prerequisites', () => {
      const course = aCourse();
      course.tags = ['  korean  '];
      course.prerequisites = ['  none  '];

      expect(course.tags[0]).toBe('korean');
      expect(course.prerequisites[0]).toBe('none');
    });

    it('leaves a new course unpublished by default', () => {
      // A newly created course must not appear in the public catalogue until
      // its author explicitly publishes it.
      expect(
        new Course({ ...buildCourse({ isPublished: undefined }), instructor: anObjectId() })
          .isPublished,
      ).toBe(false);
    });
  });

  describe('average rating (pre-save hook)', () => {
    testCase(
      {
        id: 'TC-FR-12-U01',
        name: 'The average rating is the mean of every review rating',
        requirement: 'FR-12',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'A course carries reviews rated 5, 4 and 3',
        input: "The pre('save') hook runs",
        expected: 'averageRating is 4',
      },
      async () => {
        const course = aCourse();
        course.reviews = [5, 4, 3].map((rating) => ({ user: anObjectId(), rating }));

        await runPreHooks(Course, course);

        expect(course.averageRating).toBe(4);
      },
    );

    it('leaves the average at zero when there are no reviews', async () => {
      const course = aCourse();

      await runPreHooks(Course, course);

      expect(course.averageRating).toBe(0);
    });

    it('sets the average to the single rating when there is one review', async () => {
      const course = aCourse();
      course.reviews = [{ user: anObjectId(), rating: 3 }];

      await runPreHooks(Course, course);

      expect(course.averageRating).toBe(3);
    });

    it('keeps the fractional part of an uneven average', async () => {
      // Rounding here would make a 4.5-star course indistinguishable from a
      // 5-star one in the catalogue ordering.
      const course = aCourse();
      course.reviews = [5, 4].map((rating) => ({ user: anObjectId(), rating }));

      await runPreHooks(Course, course);

      expect(course.averageRating).toBe(4.5);
    });

    it.each([
      [[1, 1, 1], 1],
      [[5, 5, 5, 5], 5],
      [[1, 5], 3],
      [[1, 2, 3, 4, 5], 3],
    ])('averages %j to %s', async (ratings, expected) => {
      const course = aCourse();
      course.reviews = ratings.map((rating) => ({ user: anObjectId(), rating }));

      await runPreHooks(Course, course);

      expect(course.averageRating).toBe(expected);
    });

    it('recalculates rather than accumulating when reviews change', async () => {
      const course = aCourse();
      course.reviews = [{ user: anObjectId(), rating: 5 }];
      await runPreHooks(Course, course);

      course.reviews.push({ user: anObjectId(), rating: 1 });
      await runPreHooks(Course, course);

      expect(course.averageRating).toBe(3);
    });
  });
});
