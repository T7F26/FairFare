import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import '@testing-library/jest-dom/vitest'
import PublishFeedback from './PublishFeedback.jsx'

describe('Publish feedback (Issue #34)', () => {
  it.each([
    [1, '1 change published'],
    [7, '7 changes published'],
  ])('displays the confirmed published count of %i', (count, message) => {
    render(<PublishFeedback outcome="published" count={count} />)

    expect(screen.getByRole('status').textContent).toBe(message)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the exact warning when there are no approved changes to publish', () => {
    render(<PublishFeedback outcome="no-approved" />)

    expect(screen.getByRole('alert').textContent).toBe('Approve at least one change first')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('replaces an earlier success with an error when the next publish fails', () => {
    const { rerender } = render(<PublishFeedback outcome="published" count={7} />)
    expect(screen.getByRole('status')).toBeInTheDocument()

    rerender(<PublishFeedback outcome="failed" count={7} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Could not publish fare changes. Try again.')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows no publication result while waiting for a response', () => {
    const { rerender } = render(<PublishFeedback outcome="published" count={7} />)

    rerender(<PublishFeedback />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([undefined, 0, -1, 1.5, '7'])('does not show success for an unconfirmed count of %s', (count) => {
    render(<PublishFeedback outcome="published" count={count} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Could not confirm how many changes were published.')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
