import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ConflictCard } from '../src/components/SyncPage.tsx'

describe('ConflictCard', () => {
  it('requires a choice per item before sending', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    render(
      <ConflictCard
        roundId="abc123xyz"
        title="Boiler room"
        labels={{ leaks: 'No leaks', pressure: 'Pressure' }}
        items={[
          {
            itemId: 'leaks',
            mine: { itemId: 'leaks', status: 'issue', note: 'rust', updatedAt: 1 },
            theirs: { itemId: 'leaks', status: 'ok', note: '', updatedAt: 2 },
          },
          {
            itemId: 'pressure',
            mine: { itemId: 'pressure', status: 'ok', reading: 5, note: '', updatedAt: 1 },
            theirs: { itemId: 'pressure', status: 'ok', reading: 6, note: '', updatedAt: 2 },
          },
        ]}
        onResolve={onResolve}
      />,
    )
    const send = screen.getByRole('button', { name: 'Keep these and send' })
    expect(send).toBeDisabled()
    expect(screen.getByText('issue · “rust”')).toBeInTheDocument()
    await user.click(screen.getAllByRole('radio', { name: /this device/i })[0]!)
    expect(send).toBeDisabled()
    await user.click(screen.getAllByRole('radio', { name: /server/i })[1]!)
    expect(send).toBeEnabled()
    await user.click(send)
    expect(onResolve).toHaveBeenCalledWith({ leaks: 'mine', pressure: 'theirs' })
  })
})
