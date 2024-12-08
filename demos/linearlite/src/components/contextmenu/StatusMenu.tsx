import { Portal } from '../Portal'
import { ReactNode, useState } from 'react'
import { ContextMenuTrigger } from '@firefox-devtools/react-contextmenu'
import { StatusOptions } from '../../types/types'
import { Menu } from './menu'

interface Props {
  id: string
  button: ReactNode
  className?: string
  onSelect?: (status: string) => void
}
export default function StatusMenu({ id, button, className, onSelect }: Props) {
  const [keyword, setKeyword] = useState(``)
  const handleSelect = (status: string) => {
    if (onSelect) onSelect(status)
  }

  let statuses = StatusOptions
  if (keyword !== ``) {
    const normalizedKeyword = keyword.toLowerCase().trim()
    statuses = statuses.filter(
      ([_icon, _id, l]) => l.toLowerCase().indexOf(normalizedKeyword) !== -1
    )
  }

  const options = statuses.map(([Icon, id, label]) => {
    return (
      <Menu.Item key={`status-${id}`} onClick={() => handleSelect(id)}>
        <Icon className="mr-3" />
        <div className="flex-1 overflow-hidden">{label}</div>
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
          size="normal"
          filterKeyword={true}
          className={className}
          searchPlaceholder="Set status..."
          onKeywordChange={(kw) => setKeyword(kw)}
        >
          {options}
        </Menu>
      </Portal>
    </>
  )
}
