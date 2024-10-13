import { Repl } from '@electric-sql/pglite-repl'
import Modal from './Modal'

interface Props {
  isOpen: boolean
  onDismiss?: () => void
}

export default function PGliteConsoleModal({ isOpen, onDismiss }: Props) {
  return (
    <Modal
      title="PGlite Console"
      isOpen={isOpen}
      onDismiss={onDismiss}
      size="large"
    >
      <div className="flex flex-col w-full h-100">
        <Repl showTime={true} />
      </div>
    </Modal>
  )
}
