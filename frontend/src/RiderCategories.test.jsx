import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import RiderCategories from './RiderCategories.jsx'

const fetchMock = vi.fn()
const categories = [
  {
    category_id: 17,
    category_name: 'Senior',
    proof_required: 'Proof of age',
    discounts: { ttc: 31.82, miway: 100 },
  },
  {
    category_id: 29,
    category_name: 'Youth',
    proof_required: 'Proof of age',
    discounts: { ttc: 28.79, miway: 17.14 },
  },
]
const savedDiscount = {
  category_id: 17,
  category_name: 'Senior',
  agency_id: 'ttc',
  discount_percentage: 35.13,
  message: 'Senior updated',
}

function discountButton(category, agency) {
  return screen.getByRole('button', { name: `Edit discount for ${category} at ${agency}` })
}

async function openSeniorEdit() {
  const user = userEvent.setup()
  render(<RiderCategories />)
  await screen.findByRole('table')
  await user.click(discountButton('Senior', 'TTC'))

  const dialog = within(screen.getByRole('dialog', { name: 'Edit Discount' }))
  const input = dialog.getByRole('spinbutton', { name: 'Discount (%)' })
  const saveButton = dialog.getByRole('button', { name: 'Save' })
  return { user, dialog, input, saveButton }
}

async function enterDiscount(user, input, value) {
  await user.clear(input)
  await user.type(input, value)
}

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValueOnce(Response.json(categories))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Saving a rider category discount', () => {
  it('sends the selected IDs and numeric input, then displays the stored percentage', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(savedDiscount))
    const { user, input, saveButton } = await openSeniorEdit()

    expect(input).toHaveValue(31.82)
    await enterDiscount(user, input, '35.125')
    await user.click(saveButton)

    expect(await screen.findByRole('status')).toHaveTextContent('Senior updated')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const request = new Request(...fetchMock.mock.calls[1])
    expect(new URL(request.url).pathname).toBe('/api/admin/rider-categories/17/discounts/ttc')
    expect(request.method).toBe('PATCH')
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(await request.json()).toEqual({ discount_percentage: 35.125 })
    expect(discountButton('Senior', 'TTC')).toHaveTextContent('35.13%')
    expect(discountButton('Senior', 'MiWay')).toHaveTextContent('100%')
    expect(discountButton('Youth', 'TTC')).toHaveTextContent('28.79%')
  })

  it.each([
    [400, 'NEGATIVE_FARE', "Fare can't be negative"],
    [404, 'DISCOUNT_NOT_FOUND', 'No discount exists for this rider category and agency.'],
    [409, 'DISCOUNT_CONFLICT', 'Multiple discounts exist for this rider category and agency.'],
    [503, 'DISCOUNT_WRITES_UNAVAILABLE', 'Discount editing is not available yet.'],
  ])('shows the HTTP %i error without changing the discount', async (status, code, message) => {
    fetchMock.mockResolvedValueOnce(Response.json({ code, message }, { status }))
    const { user, dialog, input, saveButton } = await openSeniorEdit()

    await enterDiscount(user, input, '35')
    await user.click(saveButton)

    expect(await dialog.findByRole('alert')).toHaveTextContent(message)
    expect(discountButton('Senior', 'TTC')).toHaveTextContent('31.82%')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(input).toHaveValue(35)
    expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('leaves the original value in place after a network failure and allows retry', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Network unavailable'))
      .mockResolvedValueOnce(Response.json(savedDiscount))
    const { user, dialog, input, saveButton } = await openSeniorEdit()

    await enterDiscount(user, input, '35.125')
    await user.click(saveButton)

    expect(await dialog.findByRole('alert')).toHaveTextContent('Could not save the discount. Try again.')
    expect(discountButton('Senior', 'TTC')).toHaveTextContent('31.82%')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(input).toHaveValue(35.125)

    await user.click(dialog.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Senior updated')
    expect(discountButton('Senior', 'TTC')).toHaveTextContent('35.13%')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('keeps the old value visible and sends only one request while saving', async () => {
    const pending = Promise.withResolvers()
    fetchMock.mockReturnValueOnce(pending.promise)
    const { user, dialog, input, saveButton } = await openSeniorEdit()
    await enterDiscount(user, input, '35.125')

    act(() => {
      fireEvent.submit(saveButton.form)
      fireEvent.submit(saveButton.form)
    })

    expect(dialog.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(discountButton('Senior', 'TTC')).toHaveTextContent('31.82%')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      pending.resolve(Response.json(savedDiscount))
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Senior updated')
    expect(discountButton('Senior', 'TTC')).toHaveTextContent('35.13%')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('leaves the table untouched when the successful response names a different agency', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ...savedDiscount, agency_id: 'miway' }))
    const { user, dialog, input, saveButton } = await openSeniorEdit()

    await enterDiscount(user, input, '35')
    await user.click(saveButton)

    expect(await dialog.findByRole('alert')).toHaveTextContent('Could not confirm the saved discount.')
    expect(discountButton('Senior', 'TTC')).toHaveTextContent('31.82%')
    expect(discountButton('Senior', 'MiWay')).toHaveTextContent('100%')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
