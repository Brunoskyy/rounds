import type { ChecklistItem, RoundItem } from '@rounds/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ItemRow } from '../src/components/ItemRow.tsx'
import { outOfRange } from '../src/lib/readings.ts'

const reading: ChecklistItem = {
  id: 'pressure',
  label: 'Steam pressure',
  kind: 'reading',
  unit: 'bar',
  range: { min: 4, max: 7 },
}
const check: ChecklistItem = { id: 'leaks', label: 'No leaks', kind: 'check' }
const base: RoundItem = { itemId: 'pressure', status: 'pending', note: '', updatedAt: 0 }

function setup(def: ChecklistItem, item: RoundItem, readOnly = false) {
  const onChange = vi.fn()
  render(
    <ItemRow
      def={def}
      item={item}
      readOnly={readOnly}
      onPatch={onChange}
      onPhoto={vi.fn()}
      getPhoto={() => Promise.resolve(undefined)}
    />,
  )
  return { onChange }
}

describe('outOfRange', () => {
  it('flags only readings outside the range', () => {
    expect(outOfRange(reading, 5)).toBe(false)
    expect(outOfRange(reading, 4)).toBe(false)
    expect(outOfRange(reading, 7.5)).toBe(true)
    expect(outOfRange(reading, undefined)).toBe(false)
    expect(outOfRange(check, 99)).toBe(false)
  })
})

describe('ItemRow', () => {
  it('toggles a status and clears it on a second tap', async () => {
    const user = userEvent.setup()
    const { onChange } = setup(check, { ...base, itemId: 'leaks' })
    await user.click(screen.getByRole('button', { name: 'OK' }))
    expect(onChange).toHaveBeenLastCalledWith({ status: 'ok' })
    const { onChange: again } = setup(check, { ...base, itemId: 'leaks', status: 'ok' })
    await user.click(screen.getAllByRole('button', { name: 'OK' })[1]!)
    expect(again).toHaveBeenLastCalledWith({ status: 'pending' })
  })

  it('marks an out-of-range reading as an issue and an in-range one as ok', async () => {
    const user = userEvent.setup()
    const { onChange } = setup(reading, base)
    const input = screen.getByLabelText('Steam pressure reading')
    await user.type(input, '9')
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ reading: 9, status: 'issue' }),
    )
    const ok = setup(reading, base)
    await user.type(screen.getAllByLabelText('Steam pressure reading')[1]!, '5.5')
    await user.tab()
    expect(ok.onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ reading: 5.5, status: 'ok' }),
    )
  })

  it('shows the range warning for a flagged reading', () => {
    setup(reading, { ...base, status: 'issue', reading: 12 })
    expect(screen.getByText(/outside 4–7 bar/)).toBeInTheDocument()
  })

  it('saves a note on blur and not before', async () => {
    const user = userEvent.setup()
    const { onChange } = setup(check, { ...base, itemId: 'leaks', status: 'issue' })
    await user.type(screen.getByLabelText('No leaks note'), 'drip at the flange')
    expect(onChange).not.toHaveBeenCalled()
    await user.tab()
    expect(onChange).toHaveBeenCalledWith({ note: 'drip at the flange' })
  })

  it('is inert once the round is signed off', () => {
    setup(check, { ...base, itemId: 'leaks', status: 'ok' }, true)
    expect(screen.getByRole('button', { name: 'Issue' })).toBeDisabled()
    expect(screen.getByLabelText('No leaks note')).toBeDisabled()
  })
})

describe('ItemRow while typing', () => {
  it('keeps the draft when the item changes underneath a focused field', async () => {
    const user = userEvent.setup()
    const onPatch = vi.fn()
    const props = {
      def: check,
      readOnly: false,
      onPatch,
      onPhoto: vi.fn(),
      getPhoto: () => Promise.resolve(undefined),
    }
    const { rerender } = render(
      <ItemRow {...props} item={{ ...base, itemId: 'leaks', status: 'issue' }} />,
    )
    const note = screen.getByLabelText('No leaks note')
    await user.click(note)
    await user.type(note, 'my obser')
    rerender(
      <ItemRow
        {...props}
        item={{ ...base, itemId: 'leaks', status: 'issue', note: 'from the other phone' }}
      />,
    )
    expect(note).toHaveValue('my obser')
    await user.tab()
    expect(onPatch).toHaveBeenCalledWith({ note: 'my obser' })
  })
})
