export interface MemberRef {
  id: string
}

export interface CalculatedShare {
  memberId: string
  amountCents: number
}

/**
 * Splits an integer amount of cents fairly among members.
 * Remainder cents are distributed one cent per member in the order members are passed in (seq ascending).
 *
 * Invariant: The sum of all calculated shares strictly equals totalCents.
 */
export function splitCents(totalCents: number, members: MemberRef[]): CalculatedShare[] {
  const memberCount = members.length
  if (memberCount === 0) {
    throw new Error('Cannot split bill among 0 members')
  }

  const baseAmount = Math.floor(totalCents / memberCount)
  const remainder = totalCents % memberCount

  return members.map((member, index) => ({
    memberId: member.id,
    amountCents: index < remainder ? baseAmount + 1 : baseAmount,
  }))
}
