/**
 * Frontend component tests — src/components/ProtectedRoute.jsx and
 * src/components/LoadingSpinner.jsx.
 *
 * Requirements: FR-05 (Role-Based Access Control), NFR-03 (Security),
 * NFR-05 (Usability).
 *
 * `ProtectedRoute` is the client-side half of access control. It is not a
 * security boundary — the API enforces that, and the security suite proves it —
 * but it is what stops a student ever seeing an administrative screen, and a
 * mistake here is highly visible to users.
 *
 * `useAuth` is mocked so each authentication state can be produced directly;
 * driving the real context would turn these into integration tests of the
 * login flow.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProtectedRoute from '@frontend/components/ProtectedRoute';
import LoadingSpinner from '@frontend/components/LoadingSpinner';

const mockUseAuth = vi.fn();

vi.mock('@frontend/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
  AuthProvider: ({ children }) => children,
}));

/**
 * Render a guarded route inside a router that also defines the two
 * destinations it can redirect to, so a redirect is observable as rendered
 * output rather than as an unverifiable side effect.
 */
function renderGuarded(children, { roles = [], initialPath = '/dashboard' } = {}) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/dashboard"
          element={<ProtectedRoute roles={roles}>{children}</ProtectedRoute>}
        />
        <Route path="/admin" element={<ProtectedRoute roles={roles}>{children}</ProtectedRoute>} />
        <Route path="/login" element={<p>Login page</p>} />
        <Route path="/" element={<p>Home page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const Guarded = () => <p>Protected content</p>;

describe('ProtectedRoute', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  it('renders the guarded content for an authenticated user', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      user: { id: '1', role: 'student' },
    });

    renderGuarded(<Guarded />);

    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });

  it('redirects an unauthenticated visitor to the login page', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, user: null });

    renderGuarded(<Guarded />);

    expect(screen.getByText('Login page')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('does not evaluate roles before authentication', () => {
    // Order matters: checking `user.role` first would throw on a null user and
    // replace the login redirect with a blank error screen.
    mockUseAuth.mockReturnValue({ isAuthenticated: false, user: null });

    expect(() => renderGuarded(<Guarded />, { roles: ['admin'] })).not.toThrow();
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('renders the content when no roles are required', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      user: { id: '1', role: 'student' },
    });

    renderGuarded(<Guarded />, { roles: [] });

    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });

  it.each([
    ['admin', ['admin'], true],
    ['student', ['admin'], false],
    ['instructor', ['admin'], false],
    ['instructor', ['instructor', 'admin'], true],
    ['student', ['student', 'instructor'], true],
    ['admin', ['student'], false],
  ])('a %s against required roles %j sees the content: %s', (role, roles, shouldRender) => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, user: { id: '1', role } });

    renderGuarded(<Guarded />, { roles });

    if (shouldRender) {
      expect(screen.getByText('Protected content')).toBeInTheDocument();
    } else {
      expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
      expect(screen.getByText('Home page')).toBeInTheDocument();
    }
  });

  it('sends an unauthorised role home rather than to the login page', () => {
    // The user is signed in; bouncing them to a login form they have already
    // completed is confusing. Home is the correct destination.
    mockUseAuth.mockReturnValue({ isAuthenticated: true, user: { id: '1', role: 'student' } });

    renderGuarded(<Guarded />, { roles: ['admin'], initialPath: '/admin' });

    expect(screen.getByText('Home page')).toBeInTheDocument();
    expect(screen.queryByText('Login page')).not.toBeInTheDocument();
  });

  it('renders multiple children', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, user: { id: '1', role: 'student' } });

    renderGuarded(
      <>
        <p>First child</p>
        <p>Second child</p>
      </>,
    );

    expect(screen.getByText('First child')).toBeInTheDocument();
    expect(screen.getByText('Second child')).toBeInTheDocument();
  });
});

describe('LoadingSpinner', () => {
  it('renders at the medium size by default', () => {
    const { container } = render(<LoadingSpinner />);

    expect(container.firstChild).toHaveClass('loading-spinner', 'h-6', 'w-6');
  });

  it.each([
    ['small', 'h-4'],
    ['medium', 'h-6'],
    ['large', 'h-8'],
    ['xl', 'h-12'],
  ])('renders the %s size', (size, expectedClass) => {
    const { container } = render(<LoadingSpinner size={size} />);

    expect(container.firstChild).toHaveClass(expectedClass);
  });

  it('appends any caller-supplied class name', () => {
    const { container } = render(<LoadingSpinner className="mx-auto text-blue-500" />);

    expect(container.firstChild).toHaveClass('mx-auto', 'text-blue-500');
  });

  it('still renders for an unrecognised size rather than crashing', () => {
    // `sizeClasses[size]` is undefined for an unknown key, which React renders
    // as the string "undefined" in the class list — ugly, but not a blank page.
    const { container } = render(<LoadingSpinner size="gigantic" />);

    expect(container.firstChild).toHaveClass('loading-spinner');
  });
});
