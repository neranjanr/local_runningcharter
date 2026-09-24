import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
}));

// Mock authContext for AppShell help link test
const mockUseAuth = vi.fn();

vi.mock('@/lib/authContext', async () => {
  const actual = await vi.importActual('@/lib/authContext') as any;
  return {
    ...actual,
    useAuth: () => mockUseAuth(),
  };
});

import { AppShell } from './AppShell';
import { Landing } from './Landing';
import { ToastProvider, useToast } from '@/lib/toastContext';
import { AuthProvider } from '@/lib/authContext';

// Help page sections check via static import of page component
import HelpPage from '@/app/help/page';

describe('Ticket 6 — Landing, Help, Toast, Header', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: null,
      isSuperAdmin: false,
      mustChangePassword: false,
      loading: false,
      authError: null,
      clearAuthError: vi.fn(),
      signInWithSuperAdmin: vi.fn().mockResolvedValue({ success: true, mustChangePassword: false }),
      signInWithGoogle: vi.fn().mockResolvedValue(undefined),
      signOut: vi.fn(),
      getAllowedEmailsState: () => [],
      addAllowedEmail: vi.fn(),
      removeAllowedEmail: vi.fn(),
      setAllowedEmailsState: vi.fn(),
    });
  });

  it('Landing shows Super Admin login and Google SSO buttons, not authorized error handling', async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isSuperAdmin: false,
      mustChangePassword: false,
      loading: false,
      authError: 'Not authorized — contact admin',
      clearAuthError: vi.fn(),
      signInWithSuperAdmin: vi.fn(),
      signInWithGoogle: vi.fn(),
      signOut: vi.fn(),
      getAllowedEmailsState: () => [],
      addAllowedEmail: vi.fn(),
      removeAllowedEmail: vi.fn(),
      setAllowedEmailsState: vi.fn(),
    });
    render(<Landing />);
    expect(screen.getByTestId('super-admin-username')).toBeInTheDocument();
    expect(screen.getByTestId('super-admin-password')).toBeInTheDocument();
    expect(screen.getByTestId('super-admin-login-button')).toBeInTheDocument();
    // Google SSO removed per ADR-0010 — Landing now shows Recovery link and TOTP instead
    expect(screen.queryByTestId('google-sso-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('recovery-link')).toBeInTheDocument();
    expect(screen.getByTestId('landing-error')).toHaveTextContent('Not authorized — contact admin');
  });

  it('Help Page renders 22 sections when authenticated', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'allowed@gmail.com' } as any,
      isSuperAdmin: false,
      mustChangePassword: false,
      loading: false,
      authError: null,
      clearAuthError: vi.fn(),
      signInWithSuperAdmin: vi.fn(),
      signInWithGoogle: vi.fn(),
      signOut: vi.fn(),
      getAllowedEmailsState: () => [],
      addAllowedEmail: vi.fn(),
      removeAllowedEmail: vi.fn(),
      setAllowedEmailsState: vi.fn(),
    });
    render(<HelpPage />);
    // 22 sections — titles appear twice (TOC + body), so use getAllByText
    expect(screen.getAllByText(/1\. Book Opening/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/2\. Reciprocal Calculations/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/3\. Time Estimation/).length).toBeGreaterThanOrEqual(1);
    // Search box and grouped TOC exist
    expect(screen.getByPlaceholderText(/Search help/)).toBeInTheDocument();
    expect(screen.getAllByText(/Core Concepts/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/11\. Gaps — Fill Gap/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/16\. How to Link Google Sheet/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/17\. How to Set Up Mobile/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/18\. Auth Roles/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/19\. Calendar/).length).toBeGreaterThanOrEqual(1);
  });

  it('AppShell header Help link (?) visible only after login', async () => {
    // Unauthenticated -> no help link
    mockUseAuth.mockReturnValue({
      user: null,
      isSuperAdmin: false,
      mustChangePassword: false,
      loading: false,
      authError: null,
      clearAuthError: vi.fn(),
      signInWithSuperAdmin: vi.fn(),
      signInWithGoogle: vi.fn(),
      signOut: vi.fn(),
      getAllowedEmailsState: () => [],
      addAllowedEmail: vi.fn(),
      removeAllowedEmail: vi.fn(),
      setAllowedEmailsState: vi.fn(),
    });
    const { unmount } = render(
      <AuthProvider>
        <AppShell><div>child</div></AppShell>
      </AuthProvider>
    );
    expect(screen.queryByTestId('header-help-link')).not.toBeInTheDocument();
    unmount();

    // Authenticated -> help link visible
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'allowed@gmail.com' } as any,
      isSuperAdmin: false,
      mustChangePassword: false,
      loading: false,
      authError: null,
      clearAuthError: vi.fn(),
      signInWithSuperAdmin: vi.fn(),
      signInWithGoogle: vi.fn(),
      signOut: vi.fn(),
      getAllowedEmailsState: () => [],
      addAllowedEmail: vi.fn(),
      removeAllowedEmail: vi.fn(),
      setAllowedEmailsState: vi.fn(),
    });
    render(
      <AuthProvider>
        <AppShell><div>child</div></AppShell>
      </AuthProvider>
    );
    // Header help link should appear for authenticated (desktop bar)
    expect(screen.getByTestId('header-help-link')).toBeInTheDocument();
  });

  it('Toast shows message after showToast (~2s)', async () => {
    function TestToast() {
      const { showToast } = useToast();
      return <button onClick={() => showToast('Trip Added')} data-testid="trigger-toast">trigger</button>;
    }
    render(
      <ToastProvider>
        <TestToast />
      </ToastProvider>
    );
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('trigger-toast'));
    expect(screen.getByTestId('toast')).toHaveTextContent('Trip Added');
    await waitFor(() => expect(screen.queryByTestId('toast')).not.toBeInTheDocument(), { timeout: 3000 });
  });
});
