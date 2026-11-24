// Receives UI outcomes after the publish handler interprets the server response.
export default function PublishFeedback({ outcome, count }) {
  let message
  let success = false

  switch (outcome) {
    case 'published':
      success = Number.isSafeInteger(count) && count > 0
      message = success
        ? `${count} ${count === 1 ? 'change' : 'changes'} published`
        : 'Could not confirm how many changes were published.'
      break
    case 'no-approved':
      message = 'Approve at least one change first'
      break
    case 'failed':
      message = 'Could not publish fare changes. Try again.'
      break
    default:
      return null
  }

  return (
    <p role={success ? 'status' : 'alert'} className={success ? 'message success' : 'message error'}>
      {message}
    </p>
  )
}
