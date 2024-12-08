import Modal from './Modal'

interface Props {
  isOpen: boolean
  onDismiss?: () => void
}

export default function AboutModal({ isOpen, onDismiss }: Props) {
  return (
    <Modal title="About Linearlite" isOpen={isOpen} onDismiss={onDismiss}>
      <div className="flex flex-col w-full px-8 py-5 overflow-y-auto prose prose-sm">
        <p className="my-1">
          This is an example of a team collaboration app such as{` `}
          <a
            href="https://linear.app"
            target="_blank"
            rel="noreferrer noopener"
          >
            Linear
          </a>
          {` `}
          built using{` `}
          <a
            href="http://electric-sql.com"
            target="_blank"
            rel="noreferrer noopener"
          >
            ElectricSQL
          </a>
          {` `}- the local-first sync layer for web and mobile apps.
        </p>
        <p className="my-1">
          This example is built on top of the excellent clone of the Linear UI
          built by{` `}
          <a
            href="https://github.com/tuan3w"
            target="_blank"
            rel="noreferrer noopener"
          >
            Tuan Nguyen
          </a>
          .
        </p>
        <p className="my-1">
          We have replaced the canned data with a stack running{` `}
          <a
            href="https://github.com/electric-sql/electric"
            target="_blank"
            rel="noreferrer noopener"
          >
            Electric
          </a>
          {` `}
          in Docker.
        </p>
      </div>
    </Modal>
  )
}
