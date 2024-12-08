import type { Editor as TipTapEditor } from '@tiptap/react'
import classNames from 'classnames'

import { BsTypeBold as BoldIcon } from 'react-icons/bs'
import { BsTypeItalic as ItalicIcon } from 'react-icons/bs'
import { BsTypeStrikethrough as StrikeIcon } from 'react-icons/bs'
import { BsCode as CodeIcon } from 'react-icons/bs'
import { BsListUl as BulletListIcon } from 'react-icons/bs'
import { BsListOl as OrderedListIcon } from 'react-icons/bs'
import { BsCodeSlash as CodeBlockIcon } from 'react-icons/bs'
import { BsChatQuote as BlockquoteIcon } from 'react-icons/bs'

export interface EditorMenuProps {
  editor: TipTapEditor
}

const EditorMenu = ({ editor }: EditorMenuProps) => {
  return (
    <div className="bg-white flex shadow-md rounded border p-1">
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={!editor.can().chain().focus().toggleBold().run()}
        className={classNames(
          `me-1 px-1 rounded color text-gray-500 hover:text-black`,
          {
            'bg-gray-100': editor.isActive(`bold`),
          }
        )}
      >
        <BoldIcon className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        disabled={!editor.can().chain().focus().toggleItalic().run()}
        className={classNames(
          `me-1 px-1 py-1 rounded color text-gray-500 hover:text-black`,
          {
            'bg-gray-100': editor.isActive(`italic`),
          }
        )}
      >
        <ItalicIcon className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        disabled={!editor.can().chain().focus().toggleStrike().run()}
        className={classNames(
          `me-1 px-1 py-1 rounded color text-gray-500 hover:text-black`,
          {
            'bg-gray-100': editor.isActive(`strike`),
          }
        )}
      >
        <StrikeIcon className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleCode().run()}
        disabled={!editor.can().chain().focus().toggleCode().run()}
        className={classNames(
          `me-1 px-1 py-1 rounded color text-gray-500 hover:text-black`,
          {
            'bg-gray-100': editor.isActive(`code`),
          }
        )}
      >
        <CodeIcon className="w-4 h-4" />
      </button>
      <div className="border-r me-1 border-gray-200"></div>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={classNames(
          `me-1 px-1 py-1 rounded color text-gray-500 hover:text-black`,
          {
            'bg-gray-100': editor.isActive(`bulletList`),
          }
        )}
      >
        <BulletListIcon className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={classNames(
          `me-1 px-1 py-1 rounded color text-gray-500 hover:text-black`,
          {
            'bg-gray-100': editor.isActive(`orderedList`),
          }
        )}
      >
        <OrderedListIcon className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        className={classNames(
          `me-1 px-1 py-1 rounded color text-gray-500 hover:text-black`,
          {
            'bg-gray-100': editor.isActive(`codeBlock`),
          }
        )}
      >
        <CodeBlockIcon className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={classNames(
          `px-1 py-1 rounded color text-gray-500 hover:text-black`,
          {
            'bg-gray-100': editor.isActive(`blockquote`),
          }
        )}
      >
        <BlockquoteIcon className="w-4 h-4" />
      </button>
    </div>
  )
}

export default EditorMenu
