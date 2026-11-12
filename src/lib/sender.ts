/**
 * Which account sends a reply.
 *
 * Order of preference:
 * 1. the account configured on the mailbox that received the message
 *    (`replyAccountId`), an explicit override;
 * 2. the account whose address is the alias the message was sent to
 *    (`aliasAccountId`): a domain that only forwards to a provider mailbox leaves
 *    that address in To/Cc or Delivered-To, and the reply should leave from it,
 *    like Gmail does;
 * 3. the global "reply sender" preference, when it is not `auto`;
 * 4. the account that received the message.
 */
export interface ReplySenderInput {
  messageAccountId: string
  replyAccountId: string | null
  aliasAccountId?: string | null
  defaultSender: string
  accountIds: string[]
}

export function pickReplySender(input: ReplySenderInput): string {
  const { accountIds } = input
  if (input.replyAccountId && accountIds.includes(input.replyAccountId)) {
    return input.replyAccountId
  }
  if (input.aliasAccountId && accountIds.includes(input.aliasAccountId)) {
    return input.aliasAccountId
  }
  if (input.defaultSender !== 'auto' && accountIds.includes(input.defaultSender)) {
    return input.defaultSender
  }
  return input.messageAccountId
}
