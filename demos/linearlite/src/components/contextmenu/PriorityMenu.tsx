import { Portal } from '../Portal'
import { ReactNode, useState } from 'react'
import { ContextMenuTrigger } from '@firefox-devtools/react-contextmenu'
import { Menu } from './menu'
import { PriorityOptions } from '../../types/types'

interface Props {
  id: string
  button: ReactNode
  filterKeyword?: boolean
  className?: string
  onSelect?: (item: string) => void
}

function PriorityMenu({
  id,
  button,
  filterKeyword = false,
  className,
  onSelect,
}: Props) {
  const [keyword, setKeyword] = useState(``)

  const handleSelect = (priority: string) => {
    setKeyword(``)
    if (onSelect) onSelect(priority)
  }
  let statusOpts = PriorityOptions
  if (keyword !== ``) {
    const normalizedKeyword = keyword.toLowerCase().trim()
    statusOpts = statusOpts.filter(
      ([_Icon, _priority, label]) =>
        (label as string).toLowerCase().indexOf(normalizedKeyword) !== -1
    )
  }

  const options = statusOpts.map(([Icon, priority, label]) => {
    return (
      <Menu.Item
        key={`priority-${priority}`}
        onClick={() => handleSelect(priority as string)}
      >
        <Icon className="mr-3" /> <span>{label}</span>
      </Menu.Item>
    )
  })

  return (
    <>
      <ContextMenuTrigger id={id} holdToDisplay={1}>
        {button}
      </ContextMenuTrigger>

      <Portal>
        <Menu
          id={id}
          size="small"
          filterKeyword={filterKeyword}
          searchPlaceholder="Set priority..."
          onKeywordChange={(kw) => setKeyword(kw)}
          className={className}
        >
          {options}
        </Menu>
      </Portal>
    </>
  )
}

export default PriorityMenu
