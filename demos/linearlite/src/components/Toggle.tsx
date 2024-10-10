import classnames from 'classnames'

interface Props {
  onChange?: (value: boolean) => void
  className?: string
  value?: boolean
  activeClass?: string
  activeLabelClass?: string
}
export default function Toggle({
  onChange,
  className,
  value = false,
  activeClass = `bg-indigo-600 hover:bg-indigo-700`,
  activeLabelClass = `border-indigo-600`,
}: Props) {
  const labelClasses = classnames(
    `absolute h-3.5 w-3.5 overflow-hidden border-2 transition duration-200 ease-linear rounded-full cursor-pointer bg-white`,
    {
      'left-0 border-gray-300': !value,
      'right-0': value,
      [activeLabelClass]: value,
    }
  )
  const classes = classnames(
    `group relative rounded-full w-5 h-3.5 transition duration-200 ease-linear`,
    {
      [activeClass]: value,
      'bg-gray-300': !value,
    },
    className
  )
  const onClick = () => {
    if (onChange) onChange(!value)
  }
  return (
    <div className={classes} onClick={onClick}>
      <label className={labelClasses}></label>
    </div>
  )
}
