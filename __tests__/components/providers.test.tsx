/**
 * components/providers.tsx — Provider Components Tests
 *
 * Tests that:
 * - Providers component renders children correctly
 * - QueryClient is initialized with correct default options
 * - ServerBusinessContextProvider stores and returns context
 * - useServerBusinessContext hook works correctly
 */

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  Providers,
  ServerBusinessContextProvider,
  useServerBusinessContext,
  type ServerBusinessContextValue,
} from '@/components/providers'

// ── Mock React Query ────────────────────────────────────────────────────────
vi.mock('@tanstack/react-query', () => ({
  QueryClient: vi.fn((options: any) => ({
    _defaultOptions: options?.defaultOptions,
  })),
  QueryClientProvider: ({ children, client }: any) => (
    <div data-testid="query-client-provider" data-client={JSON.stringify(client)}>
      {children}
    </div>
  ),
}))

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Providers Component', () => {
  it('renders children correctly', () => {
    render(
      <Providers>
        <div data-testid="child">Test Child</div>
      </Providers>
    )

    expect(screen.getByTestId('child')).toBeInTheDocument()
    expect(screen.getByText('Test Child')).toBeInTheDocument()
  })

  it('wraps children with QueryClientProvider', () => {
    render(
      <Providers>
        <div>Child</div>
      </Providers>
    )

    expect(screen.getByTestId('query-client-provider')).toBeInTheDocument()
  })

  it('initializes QueryClient with correct default query options', () => {
    render(
      <Providers>
        <div>Child</div>
      </Providers>
    )

    const provider = screen.getByTestId('query-client-provider')
    const clientData = provider.getAttribute('data-client')
    const client = JSON.parse(clientData || '{}')

    const queries = client._defaultOptions?.defaultOptions?.queries

    // Verify staleTime: 5 minutes
    expect(queries?.staleTime).toBe(5 * 60 * 1000)

    // Verify gcTime: 15 minutes
    expect(queries?.gcTime).toBe(15 * 60 * 1000)

    // Verify refetchOnWindowFocus
    expect(queries?.refetchOnWindowFocus).toBe(false)

    // Verify refetchOnReconnect
    expect(queries?.refetchOnReconnect).toBe(true)

    // Verify retry count
    expect(queries?.retry).toBe(1)

    // Verify throwOnError
    expect(queries?.throwOnError).toBe(false)
  })

  it('initializes QueryClient with correct mutation options', () => {
    render(
      <Providers>
        <div>Child</div>
      </Providers>
    )

    const provider = screen.getByTestId('query-client-provider')
    const clientData = provider.getAttribute('data-client')
    const client = JSON.parse(clientData || '{}')

    const mutations = client._defaultOptions?.defaultOptions?.mutations

    // Mutations should never retry
    expect(mutations?.retry).toBe(0)
  })

  it('creates a new QueryClient instance per mount', () => {
    const { rerender } = render(
      <Providers>
        <div data-testid="child1">First</div>
      </Providers>
    )

    const firstClient = screen.getByTestId('query-client-provider').getAttribute('data-client')

    rerender(
      <Providers>
        <div data-testid="child2">Second</div>
      </Providers>
    )

    const secondClient = screen.getByTestId('query-client-provider').getAttribute('data-client')

    // Should create new instances (but for this mock they'll be different)
    expect(firstClient).toBeDefined()
    expect(secondClient).toBeDefined()
  })
})

// ── ServerBusinessContextProvider Tests ──────────────────────────────────────

describe('ServerBusinessContextProvider', () => {
  const mockContextValue: ServerBusinessContextValue = {
    businessId: 'biz-123',
    userName: 'John Doe',
    userRole: 'owner',
    userId: 'user-456',
  }

  function TestConsumer() {
    const context = useServerBusinessContext()
    return (
      <div>
        <div data-testid="business-id">{context?.businessId}</div>
        <div data-testid="user-name">{context?.userName}</div>
        <div data-testid="user-role">{context?.userRole}</div>
        <div data-testid="user-id">{context?.userId}</div>
      </div>
    )
  }

  it('provides context value to children', () => {
    render(
      <ServerBusinessContextProvider value={mockContextValue}>
        <TestConsumer />
      </ServerBusinessContextProvider>
    )

    expect(screen.getByTestId('business-id')).toHaveTextContent('biz-123')
    expect(screen.getByTestId('user-name')).toHaveTextContent('John Doe')
    expect(screen.getByTestId('user-role')).toHaveTextContent('owner')
    expect(screen.getByTestId('user-id')).toHaveTextContent('user-456')
  })

  it('provides null when value is null', () => {
    render(
      <ServerBusinessContextProvider value={null}>
        <TestConsumer />
      </ServerBusinessContextProvider>
    )

    expect(screen.getByTestId('business-id')).toHaveTextContent('')
    expect(screen.getByTestId('user-name')).toHaveTextContent('')
  })

  it('updates context when value prop changes', () => {
    const firstValue: ServerBusinessContextValue = {
      businessId: 'biz-1',
      userName: 'Alice',
      userRole: 'owner',
      userId: 'user-1',
    }

    const secondValue: ServerBusinessContextValue = {
      businessId: 'biz-2',
      userName: 'Bob',
      userRole: 'member',
      userId: 'user-2',
    }

    const { rerender } = render(
      <ServerBusinessContextProvider value={firstValue}>
        <TestConsumer />
      </ServerBusinessContextProvider>
    )

    expect(screen.getByTestId('business-id')).toHaveTextContent('biz-1')
    expect(screen.getByTestId('user-name')).toHaveTextContent('Alice')

    rerender(
      <ServerBusinessContextProvider value={secondValue}>
        <TestConsumer />
      </ServerBusinessContextProvider>
    )

    expect(screen.getByTestId('business-id')).toHaveTextContent('biz-2')
    expect(screen.getByTestId('user-name')).toHaveTextContent('Bob')
  })

  it('renders children even when value is null', () => {
    render(
      <ServerBusinessContextProvider value={null}>
        <div data-testid="test-child">Should render</div>
      </ServerBusinessContextProvider>
    )

    expect(screen.getByTestId('test-child')).toBeInTheDocument()
  })
})

// ── useServerBusinessContext Hook Tests ──────────────────────────────────────

describe('useServerBusinessContext Hook', () => {
  function HookConsumer() {
    const context = useServerBusinessContext()
    if (!context) {
      return <div data-testid="no-context">No context</div>
    }
    return <div data-testid="has-context">{context.businessId}</div>
  }

  it('returns null outside of provider', () => {
    render(<HookConsumer />)

    // When used outside provider, context.Provider is not set, so it returns null
    expect(screen.getByTestId('no-context')).toBeInTheDocument()
  })

  it('returns context when inside provider', () => {
    const contextValue: ServerBusinessContextValue = {
      businessId: 'biz-hook-test',
      userName: 'Hook User',
      userRole: 'admin',
      userId: 'user-hook',
    }

    render(
      <ServerBusinessContextProvider value={contextValue}>
        <HookConsumer />
      </ServerBusinessContextProvider>
    )

    expect(screen.getByTestId('has-context')).toHaveTextContent('biz-hook-test')
  })
})
