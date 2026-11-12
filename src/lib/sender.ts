/**
 * Which account sends a reply.
 *
 * Order of preference:
 * 1. the account configured on the mailbox that received the message
 *    (`replyAccountId`), e.g. the send-only account of the domain that forwards
 *    to the provider mailbox;
 * 2. the global "reply sender" preference, when it is not `auto`;
 * 3. the account that received the message.
 */
export interface ReplySenderInput {
  messageAccountId: string
  replyAccountId: string | null
  defaultSender: string
  accountIds: string[]
}

export function pickReplySender(input: ReplySenderInput): string {
  const { accountIds } = input
  if (input.replyAccountId && accountIds.includes(input.replyAccountId)) {
    return input.replyAccountId
  }
  if (input.defaultSender !== 'auto' && accountIds.includes(input.defaultSender)) {
    return input.defaultSender
  }
  return input.messageAccountId
}
