import { StrictMode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import ReviewUpdates from './ReviewUpdates.jsx'

const fetchMock = vi.fn()
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

function fareChangesResponse(changes) {
  return Response.json({
    agencyId: 'miway',
    uploadedAt: '2026-11-20T18:00:00.000Z',
    count: changes.length,
    changes,
  })
}

async function renderFareChanges(changes) {
  fetchMock.mockResolvedValueOnce(fareChangesResponse(changes))
  render(<ReviewUpdates />)
  await screen.findByRole('table')
}

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
    expect(screen.getByRole('button', { name: 'Publish approved changes' })).toBeDisabled()
    expect(row.getByRole('cell', { name: 'Approved' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await expectStatusRequest(adultFare.fare_id, 'approved')

    save.resolve(new Response(null, { status: 500 }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the change. Try again.')
    expect(row.getByRole('cell', { name: 'Waiting for review' })).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Approve' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Publish approved changes' })).toBeEnabled()
    expect(screen.getByText('0 of 1 changes approved')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('Publish approved changes (Issue #34)', () => {
  const approvedAdultFare = { ...adultFare, status: 'approved' }
  const approvedYouthFare = { ...youthFare, status: 'approved' }
  const publishButtonName = 'Publish approved changes'
  const noApprovedWarning = 'Approve at least one change first'
  const publishError = 'Could not publish fare changes. Try again.'

  it.each([
    [[approvedAdultFare], 1, '1 change published'],
    [[approvedAdultFare, approvedYouthFare], 2, '2 changes published'],
    // A mixed list can be published, and only the server confirms the final count.
    [[approvedAdultFare, youthFare], 7, '7 changes published'],
  ])('posts approved changes and shows the server count %#', async (changes, count, message) => {
    const user = userEvent.setup()
    await renderFareChanges(changes)
    fetchMock
      .mockResolvedValueOnce(Response.json({ agencyId: 'miway', published_count: count }))
      .mockResolvedValueOnce(fareChangesResponse([]))

    await user.click(screen.getByRole('button', { name: publishButtonName }))

    expect(await screen.findByText('No fare changes in this import.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(message)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const [initial, publish, refresh] = fetchMock.mock.calls.map((call) => new Request(...call))
    expect(new URL(publish.url).pathname).toBe('/api/admin/fare-changes/publish')
    expect(publish.method).toBe('POST')
    expect(publish.body).toBeNull()
    expect(refresh.method).toBe('GET')
    expect(refresh.url).toBe(initial.url)
  })

  it('warns when no fares are approved without making a publish request', async () => {
    const user = userEvent.setup()
    await renderFareChanges([adultFare, youthFare])

    await user.click(screen.getByRole('button', { name: publishButtonName }))

    expect(screen.getByRole('alert').textContent).toBe(noApprovedWarning)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['the server finds no approved fares', () => Response.json({ code: 'NO_APPROVED_CHANGES' }, { status: 400 }), noApprovedWarning],
    ['an HTTP error occurs', () => Response.json({ code: 'FARE_PUBLISH_FAILED' }, { status: 500 }), publishError],
    ['the network request fails', () => Promise.reject(new TypeError('Network unavailable')), publishError],
  ])('shows an alert when %s', async (_case, respond, message) => {
    const user = userEvent.setup()
    await renderFareChanges([approvedAdultFare])
    fetchMock.mockImplementationOnce(respond)

    await user.click(screen.getByRole('button', { name: publishButtonName }))

    expect((await screen.findByRole('alert')).textContent).toBe(message)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: publishButtonName })).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['missing count', () => Response.json({ agencyId: 'miway' })],
    ['invalid count', () => Response.json({ published_count: '7' })],
    ['malformed JSON', () => new Response('{')],
  ])('does not report success for a response with %s', async (_case, respond) => {
    const user = userEvent.setup()
    await renderFareChanges([approvedAdultFare])
    fetchMock
      .mockImplementationOnce(respond)
      .mockResolvedValueOnce(fareChangesResponse([]))

    await user.click(screen.getByRole('button', { name: publishButtonName }))

    expect(await screen.findByText('No fare changes in this import.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not confirm how many changes were published.')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('prevents repeat clicks and status changes while publishing and refreshing', async () => {
    const user = userEvent.setup()
    await renderFareChanges([approvedAdultFare, youthFare])
    const publish = Promise.withResolvers()
    const refresh = Promise.withResolvers()
    fetchMock.mockReturnValueOnce(publish.promise).mockReturnValueOnce(refresh.promise)

    await user.dblClick(screen.getByRole('button', { name: publishButtonName }))

    const publishingButton = screen.getByRole('button', { name: 'Publishing…' })
    expect(publishingButton).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    publish.resolve(Response.json({ published_count: 1 }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(publishingButton).toBeDisabled()
    await user.click(publishingButton)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    refresh.resolve(fareChangesResponse([youthFare]))
    expect(await screen.findByRole('button', { name: publishButtonName })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('clears a previous success immediately when starting a new publish that fails', async () => {
    const user = userEvent.setup()
    await renderFareChanges([approvedAdultFare])
    const nextPublish = Promise.withResolvers()
    fetchMock
      .mockResolvedValueOnce(Response.json({ published_count: 1 }))
      .mockResolvedValueOnce(fareChangesResponse([approvedYouthFare]))
      .mockReturnValueOnce(nextPublish.promise)

    await user.click(screen.getByRole('button', { name: publishButtonName }))
    expect(await screen.findByRole('cell', { name: youthFare.fare_id })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 change published')

    await user.click(screen.getByRole('button', { name: publishButtonName }))
    expect(screen.getByRole('button', { name: 'Publishing…' })).toBeDisabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    nextPublish.resolve(new Response(null, { status: 500 }))
    expect(await screen.findByRole('alert')).toHaveTextContent(publishError)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('preserves confirmed success when the subsequent refresh fails', async () => {
    const user = userEvent.setup()
    await renderFareChanges([approvedAdultFare])
    fetchMock
      .mockResolvedValueOnce(Response.json({ published_count: 1 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))

    await user.click(screen.getByRole('button', { name: publishButtonName }))

    expect(await screen.findByText(/Could not load fare changes/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 change published')
  })

  it('ignores an older initial load that finishes after the publish refresh', async () => {
    const user = userEvent.setup()
    const earlierLoad = Promise.withResolvers()
    fetchMock
      .mockReturnValueOnce(earlierLoad.promise)
      .mockResolvedValueOnce(fareChangesResponse([approvedAdultFare]))
      .mockResolvedValueOnce(Response.json({ published_count: 1 }))
      .mockResolvedValueOnce(fareChangesResponse([]))

    render(<StrictMode><ReviewUpdates /></StrictMode>)
    await user.click(await screen.findByRole('button', { name: publishButtonName }))
    expect(await screen.findByText('No fare changes in this import.')).toBeInTheDocument()

    await act(async () => {
      earlierLoad.resolve(fareChangesResponse([approvedAdultFare]))
    })

    expect(screen.getByText('No fare changes in this import.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 change published')
  })
})
