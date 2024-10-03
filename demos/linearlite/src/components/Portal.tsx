import { ReactNode, useState } from 'react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

//Copied from https://github.com/tailwindlabs/headlessui/blob/71730fea1291e572ae3efda16d8644f870d87750/packages/%40headlessui-react/pages/menu/menu-with-popper.tsx#L90
export function Portal(props: { children: ReactNode }) {
  const { children } = props
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) return null
  return createPortal(children, document.body)
}
