import Modal from '../../components/Modal'

interface Props {
  isOpen: boolean
  setIsOpen: (isOpen: boolean) => void
  onDismiss?: () => void
  deleteIssue: () => void
}

export default function AboutModal({
  isOpen,
  setIsOpen,
  onDismiss,
  deleteIssue,
}: Props) {
  const handleDelete = () => {
    setIsOpen(false)
    if (onDismiss) onDismiss()
    deleteIssue()
  }

  return (
    <Modal title="Delete Issue" isOpen={isOpen} onDismiss={onDismiss}>
      <div className="flex flex-col w-full px-8 py-5 overflow-y-auto">
        Are you sure you want to delete this issue?
      </div>
      <div className="flex w-full border-t border-gray-200 px-4 py-3">
        <button
          type="button"
          className="px-3 ml-auto text-white bg-gray-300 rounded hover:bg-gray-400 h-7"
          onClick={() => {
            setIsOpen(false)
            if (onDismiss) onDismiss()
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="px-3 ml-3 text-white bg-indigo-600 rounded hover:bg-indigo-700 h-7"
          onClick={handleDelete}
        >
          Delete Issue
        </button>
      </div>
    </Modal>
  )
}
