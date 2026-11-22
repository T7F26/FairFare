import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import ReviewUpdates from './ReviewUpdates.jsx'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Review Updates before approval', () => {
  it('loads multiple pending changes with a single read-only request', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({
      agencyId: 'miway',
      uploadedAt: '2026-11-20T18:00:00.000Z',
      count: 3,
      changes: [
        { fare_id: 'miway_adult', agency_id: 'miway', old_price: '3.10', new_price: '3.50' },
        { fare_id: 'miway_child', agency_id: 'miway', old_price: null, new_price: '0.00' },
        { fare_id: 'miway_legacy', agency_id: 'miway', old_price: '2.00', new_price: null },
      ],
    }))

    render(<ReviewUpdates />)
    expect(screen.getByText('Loading fare changes…')).toBeInTheDocument()
    expect(screen.queryByText('No fare changes in this import.')).not.toBeInTheDocument()

    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    // Approval may add columns. Verify the four fare details without constraining those controls.
    const fareDetails = rows.map((row) => within(row).getAllByRole('cell').slice(0, 4).map((cell) => cell.textContent))
    expect(fareDetails).toEqual([
      ['miway_adult', 'miway', '$3.10', '$3.50'],
      ['miway_child', 'miway', '—', '$0.00'],
      ['miway_legacy', 'miway', '$2.00', '—'],
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [input, options] = fetchMock.mock.calls[0]
    const request = new Request(input, options)
    expect(new URL(request.url).pathname).toMatch(/\/api\/admin\/fare-changes$/)
    expect(request.method).toBe('GET')
  })

  it('shows the empty state when the pending import has no fare changes', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({
      agencyId: 'miway',
      uploadedAt: '2026-11-20T18:00:00.000Z',
      count: 0,
      changes: [],
    }))

    render(<ReviewUpdates />)

    expect(await screen.findByText('No fare changes in this import.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText('Loading fare changes…')).not.toBeInTheDocument()
  })

  it.each([
    ['an HTTP error', () => Promise.resolve(new Response(null, { status: 500 }))],
    ['a network error', () => Promise.reject(new TypeError('Network unavailable'))],
    ['invalid JSON', () => Promise.resolve(new Response('{'))],
  ])('shows a load error for %s', async (_case, respond) => {
    fetchMock.mockImplementationOnce(respond)

    render(<ReviewUpdates />)

    expect(await screen.findByText(/Could not load fare changes/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText('No fare changes in this import.')).not.toBeInTheDocument()
    expect(screen.queryByText('Loading fare changes…')).not.toBeInTheDocument()
  })
})

describe('Approve Fare Change (Issue #30)', () => {
  const adultFare = {
    fare_id: 'miway_adult/presto',
    agency_id: 'miway',
    old_price: '3.10',
    new_price: '3.50',
    status: 'waiting',
  }
  const youthFare = {
    fare_id: 'miway_youth',
    agency_id: 'miway',
    old_price: '2.25',
    new_price: '2.50',
    status: 'waiting',
  }

  async function renderFareChanges(changes) {
    fetchMock.mockResolvedValueOnce(Response.json({
      agencyId: 'miway',
      uploadedAt: '2026-11-20T18:00:00.000Z',
      count: changes.length,
      changes,
    }))
    render(<ReviewUpdates />)
    await screen.findByRole('table')
  }

  function fareRow(fareId) {
    return within(screen.getByRole('cell', { name: fareId, exact: true }).closest('tr'))
  }

  function mockSavedStatus(fare, status, allApproved) {
    fetchMock.mockResolvedValueOnce(Response.json({
      fare_id: fare.fare_id,
      agency_id: fare.agency_id,
      status,
      allApproved,
    }))
  }

  async function expectStatusRequest(fareId, status) {
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [listCall, patchCall] = fetchMock.mock.calls
    const listRequest = new Request(...listCall)
    const patchRequest = new Request(...patchCall)
    expect(patchRequest.url).toBe(`${listRequest.url}/${encodeURIComponent(fareId)}/status`)
    expect(patchRequest.method).toBe('PATCH')
    expect(patchRequest.headers.get('content-type')).toBe('application/json')
    expect(await patchRequest.json()).toEqual({ status })
  }

  it('saves an approval and displays the approved status after confirmation', async () => {
    const user = userEvent.setup()
    await renderFareChanges([adultFare])
    mockSavedStatus(adultFare, 'approved', true)
    const row = fareRow(adultFare.fare_id)
    expect(row.getByRole('cell', { name: 'Waiting for review' })).toBeInTheDocument()

    await user.click(row.getByRole('button', { name: 'Approve' }))

    // Wait for the save result so an optimistic UI change alone cannot pass.
    expect(await screen.findByRole('status')).toHaveTextContent('Fare approved')
    await expectStatusRequest(adultFare.fare_id, 'approved')
    expect(row.getByRole('cell', { name: 'Approved' })).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Undo' })).toBeEnabled()
  })

  it('saves an undo and returns the fare to Waiting for review', async () => {
    const user = userEvent.setup()
    await renderFareChanges([{ ...adultFare, status: 'approved' }])
    mockSavedStatus(adultFare, 'waiting', false)
    const row = fareRow(adultFare.fare_id)
    expect(row.getByRole('cell', { name: 'Approved' })).toBeInTheDocument()

    await user.click(row.getByRole('button', { name: 'Undo' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Approval undone')
    await expectStatusRequest(adultFare.fare_id, 'waiting')
    expect(row.getByRole('cell', { name: 'Waiting for review' })).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Approve' })).toBeEnabled()
  })

  it('counts only the fare approved when multiple changes are waiting', async () => {
    const user = userEvent.setup()
    await renderFareChanges([adultFare, youthFare])
    mockSavedStatus(adultFare, 'approved', false)
    const adultRow = fareRow(adultFare.fare_id)
    const youthRow = fareRow(youthFare.fare_id)
    expect(screen.getByText('0 of 2 changes approved')).toBeInTheDocument()

    await user.click(adultRow.getByRole('button', { name: 'Approve' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Fare approved')
    await expectStatusRequest(adultFare.fare_id, 'approved')
    expect(adultRow.getByRole('cell', { name: 'Approved' })).toBeInTheDocument()
    expect(youthRow.getByRole('cell', { name: 'Waiting for review' })).toBeInTheDocument()
    expect(youthRow.getByRole('button', { name: 'Approve' })).toBeEnabled()
    expect(screen.getByText('1 of 2 changes approved')).toBeInTheDocument()
  })

  it('rolls back the optimistic approval and shows an error when saving fails', async () => {
    const user = userEvent.setup()
    await renderFareChanges([adultFare])
    const save = Promise.withResolvers()
    fetchMock.mockReturnValueOnce(save.promise)
    const row = fareRow(adultFare.fare_id)

    await user.click(row.getByRole('button', { name: 'Approve' }))

    expect(row.getByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(row.getByRole('cell', { name: 'Approved' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await expectStatusRequest(adultFare.fare_id, 'approved')

    save.resolve(new Response(null, { status: 500 }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the change. Try again.')
    expect(row.getByRole('cell', { name: 'Waiting for review' })).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Approve' })).toBeEnabled()
    expect(screen.getByText('0 of 1 changes approved')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  // Issue #32 owns the Publish button. Exercise its gating once the control exists.
  it.todo('enables Publish only after all changes are approved and disables it again on Undo')
})
