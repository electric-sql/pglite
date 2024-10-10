import { Portal } from '../Portal'
import { ReactNode, useState } from 'react'
import { ContextMenuTrigger } from '@firefox-devtools/react-contextmenu'
import { BsCheck2 } from 'react-icons/bs'
import { Menu } from './menu'
import { useFilterState } from '../../utils/filterState'
import { PriorityOptions, StatusOptions } from '../../types/types'

interface Props {
  id: string
  button: ReactNode
  className?: string
}

function FilterMenu({ id, button, className }: Props) {
  const [filterState, setFilterState] = useFilterState()
  const [keyword, setKeyword] = useState(``)

  let priorities = PriorityOptions
  if (keyword !== ``) {
    const normalizedKeyword = keyword.toLowerCase().trim()
    priorities = priorities.filter(
      ([_icon, _priority, label]) =>
        (label as string).toLowerCase().indexOf(normalizedKeyword) !== -1
    )
  }

  let statuses = StatusOptions
  if (keyword !== ``) {
    const normalizedKeyword = keyword.toLowerCase().trim()
    statuses = statuses.filter(
      ([_icon, _status, label]) =>
        label.toLowerCase().indexOf(normalizedKeyword) !== -1
    )
  }

  const priorityOptions = priorities.map(([Icon, priority, label]) => {
    return (
      <Menu.Item
        key={`priority-${priority}`}
        onClick={() => handlePrioritySelect(priority as string)}
      >
        <Icon className="mr-3" />
        <span>{label}</span>
        {filterState.priority?.includes(priority) && (
          <BsCheck2 className="ml-auto" />
        )}
      </Menu.Item>
    )
  })

  const statusOptions = statuses.map(([Icon, status, label]) => {
    return (
      <Menu.Item
        key={`status-${status}`}
        onClick={() => handleStatusSelect(status as string)}
      >
        <Icon className="mr-3" />
        <span>{label}</span>
        {filterState.status?.includes(status) && (
          <BsCheck2 className="ml-auto" />
        )}
      </Menu.Item>
    )
  })

  const handlePrioritySelect = (priority: string) => {
    setKeyword(``)
    const newPriority = filterState.priority || []
    if (newPriority.includes(priority)) {
      newPriority.splice(newPriority.indexOf(priority), 1)
    } else {
      newPriority.push(priority)
    }
    setFilterState({
      ...filterState,
      priority: newPriority,
    })
  }

  const handleStatusSelect = (status: string) => {
    setKeyword(``)
    const newStatus = filterState.status || []
    if (newStatus.includes(status)) {
      newStatus.splice(newStatus.indexOf(status), 1)
    } else {
      newStatus.push(status)
    }
    setFilterState({
      ...filterState,
      status: newStatus,
    })
  }

  return (
    <>
      <ContextMenuTrigger id={id} holdToDisplay={1}>
        {button}
      </ContextMenuTrigger>

      <Portal>
        <Menu
          id={id}
          size="normal"
          filterKeyword={false}
          className={className}
          searchPlaceholder="Filter by..."
          onKeywordChange={(kw) => setKeyword(kw)}
        >
          {priorityOptions && <Menu.Header>Priority</Menu.Header>}
          {priorityOptions}
          {priorityOptions && statusOptions && <Menu.Divider />}
          {statusOptions && <Menu.Header>Status</Menu.Header>}
          {statusOptions}
        </Menu>
      </Portal>
    </>
  )
}

export default FilterMenu
