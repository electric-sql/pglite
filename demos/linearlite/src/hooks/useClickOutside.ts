import { RefObject, useCallback, useEffect } from 'react'

export const useClickOutside = (
  ref: RefObject<Element>,
  callback: (event: MouseEvent | TouchEvent) => void,
  outerRef?: RefObject<Element>
): void => {
  const handleClick = useCallback(
    (event: MouseEvent | TouchEvent) => {
      if (!event.target || outerRef?.current?.contains(event.target as Node)) {
        return
      }
      if (ref.current && !ref.current.contains(event.target as Node)) {
        callback(event)
      }
    },
    [callback, ref, outerRef]
  )
  useEffect(() => {
    document.addEventListener(`mousedown`, handleClick)
    document.addEventListener(`touchstart`, handleClick)

    return () => {
      document.removeEventListener(`mousedown`, handleClick)
      document.removeEventListener(`touchstart`, handleClick)
    }
  })
}
