import classNames from 'classnames'
import { ReactNode } from 'react'

interface Props {
  className?: string
  children: ReactNode
  defaultValue?: string | number | ReadonlyArray<string>
  value?: string | number | ReadonlyArray<string>
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void
}
export default function Select(props: Props) {
  const { children, defaultValue, className, value, onChange, ...rest } = props

  const classes = classNames(
    `form-select text-xs focus:ring-transparent form-select text-gray-800 h-6 bg-gray-100 rounded pr-4.5 bg-right pl-2 py-0 appearance-none focus:outline-none border-none`,
    className
  )
  return (
    <select
      {...rest}
      defaultValue={defaultValue}
      className={classes}
      value={value}
      onChange={onChange}
    >
      {children}
    </select>
  )
}
