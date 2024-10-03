import { memo, useEffect, useRef, useState } from 'react'
import { generateKeyBetween } from 'fractional-indexing'

import { BsChevronRight as ChevronRight } from 'react-icons/bs'
import { ReactComponent as CloseIcon } from '../assets/icons/close.svg'
import { ReactComponent as ElectricIcon } from '../assets/images/icon.inverse.svg'

import Modal from '../components/Modal'
import Editor from '../components/editor/Editor'
import PriorityIcon from './PriorityIcon'
import StatusIcon from './StatusIcon'
import PriorityMenu from './contextmenu/PriorityMenu'
import StatusMenu from './contextmenu/StatusMenu'

import { Priority, Status, PriorityDisplay } from '../types/types'
import { showInfo, showWarning } from '../utils/notification'
import { usePGlite } from '@electric-sql/pglite-react'
import { Issue } from '../types/types'
import config from '../config'

interface Props {
  isOpen: boolean
  onDismiss?: () => void
}

function IssueModal({ isOpen, onDismiss }: Props) {
  const ref = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(``)
  const [description, setDescription] = useState<string>()
  const [priority, setPriority] = useState(Priority.NONE)
  const [status, setStatus] = useState(Status.BACKLOG)
  const pg = usePGlite()

  const handleSubmit = async () => {
    if (title === '') {
      showWarning('Please enter a title before submitting', 'Title required')
      return
    }

    if (config.readonly) {
      showWarning('This is a read-only demo', 'Read-only')
      if (onDismiss) onDismiss()
      reset()
      return
    }

    const lastIssue = (
      await pg.query<Issue>(`
        SELECT * FROM issue
        ORDER BY kanbanorder DESC
        LIMIT 1
      `)
    )?.rows[0]
    const kanbanorder = generateKeyBetween(lastIssue?.kanbanorder, null)

    const date = new Date()
    await pg.sql`
      INSERT INTO issue (id, title, username, priority, status, description, modified, created, kanbanorder)
      VALUES (${crypto.randomUUID()}, ${title}, ${'testuser'}, ${priority}, ${status}, ${description ?? ''}, ${date}, ${date}, ${kanbanorder})
    `

    if (onDismiss) onDismiss()
    reset()
    showInfo(`You created new issue.`, `Issue created`)
  }

  const handleClickCloseBtn = () => {
    if (onDismiss) onDismiss()
    reset()
  }

  const reset = () => {
    setTimeout(() => {
      setTitle(``)
      setDescription(``)
      setPriority(Priority.NONE)
      setStatus(Status.BACKLOG)
    }, 250)
  }

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        ref.current?.focus()
      }, 250)
    }
  }, [isOpen])

  const body = (
    <div className="flex flex-col w-full py-4 overflow-hidden">
      {/* header */}
      <div className="flex items-center justify-between flex-shrink-0 px-4">
        <div className="flex items-center">
          <span className="inline-flex items-center p-1 px-2 text-gray-400 bg-gray-100 rounded">
            <ElectricIcon className="w-3 h-3 scale-150 mr-1" />
            <span>electric</span>
          </span>
          <ChevronRight className="ml-1" />
          <span className="ml-1 font-normal text-gray-700">New Issue</span>
        </div>
        <div className="flex items-center">
          <button
            className="inline-flex rounded items-center justify-center ml-2 text-gray-500 h-7 w-7 hover:bg-gray-100 rouned hover:text-gray-700"
            onClick={handleClickCloseBtn}
          >
            <CloseIcon className="w-4" />
          </button>
        </div>
      </div>
      <div className="flex flex-col flex-1 pb-3.5 overflow-y-auto">
        {/* Issue title */}
        <div className="flex items-center w-full mt-1.5 px-4">
          <StatusMenu
            id="status-menu"
            button={
              <button className="flex items-center justify-center w-6 h-6 border-none rounded hover:bg-gray-100">
                <StatusIcon status={status} />
              </button>
            }
            onSelect={(st) => {
              setStatus(st)
            }}
          />
          <input
            className="w-full ml-1.5 text-lg font-semibold placeholder-gray-400 border-none h-7 focus:border-none focus:outline-none focus:ring-0"
            placeholder="Issue title"
            value={title}
            ref={ref}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {/* Issue description editor */}
        <div className="w-full px-4">
          <Editor
            className="prose w-full max-w-full mt-2 font-normal appearance-none min-h-12 p-1 text-md editor border border-transparent focus:outline-none focus:ring-0"
            value={description || ``}
            onChange={(val) => setDescription(val)}
            placeholder="Add description..."
          />
        </div>
      </div>

      {/* Issue labels & priority */}
      <div className="flex items-center px-4 pb-3 mt-1 border-b border-gray-200">
        <PriorityMenu
          id="priority-menu"
          button={
            <button className="inline-flex items-center h-6 px-2 text-gray-500 bg-gray-200 border-none rounded hover:bg-gray-100 hover:text-gray-700">
              <PriorityIcon priority={priority} className="mr-1" />
              <span>{PriorityDisplay[priority]}</span>
            </button>
          }
          onSelect={(val) => {
            console.log(val)
            setPriority(val)
          }}
        />
      </div>
      {/* Footer */}
      <div className="flex items-center flex-shrink-0 px-4 pt-3">
        <button
          className="px-3 ml-auto text-white bg-indigo-600 rounded hover:bg-indigo-700 h-7"
          onClick={handleSubmit}
        >
          Save Issue
        </button>
      </div>
    </div>
  )

  return (
    <Modal isOpen={isOpen} center={false} size="large" onDismiss={onDismiss}>
      {body}
    </Modal>
  )
}

export default memo(IssueModal)
