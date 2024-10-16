import type React from 'react'

import { ReactComponent as CancelIcon } from '../assets/icons/cancel.svg'
import { ReactComponent as BacklogIcon } from '../assets/icons/circle-dot.svg'
import { ReactComponent as TodoIcon } from '../assets/icons/circle.svg'
import { ReactComponent as DoneIcon } from '../assets/icons/done.svg'
import { ReactComponent as InProgressIcon } from '../assets/icons/half-circle.svg'

import { ReactComponent as HighPriorityIcon } from '../assets/icons/signal-strong.svg'
import { ReactComponent as LowPriorityIcon } from '../assets/icons/signal-weak.svg'
import { ReactComponent as MediumPriorityIcon } from '../assets/icons/signal-medium.svg'
import { ReactComponent as NoPriorityIcon } from '../assets/icons/dots.svg'
import { ReactComponent as UrgentPriorityIcon } from '../assets/icons/rounded-claim.svg'

export type Issue = {
  id: string
  title: string
  description: string
  priority: (typeof Priority)[keyof typeof Priority]
  status: (typeof Status)[keyof typeof Status]
  modified: Date
  created: Date
  kanbanorder: string
  username: string
  synced: boolean
}

export type Comment = {
  id: string
  body: string
  username: string
  issue_id: string
  created: Date
  synced: boolean
}

export const Priority = {
  NONE: `none`,
  URGENT: `urgent`,
  HIGH: `high`,
  LOW: `low`,
  MEDIUM: `medium`,
} as const

export type PriorityValue = (typeof Priority)[keyof typeof Priority]

export const PriorityDisplay = {
  [Priority.NONE]: `None`,
  [Priority.URGENT]: `Urgent`,
  [Priority.HIGH]: `High`,
  [Priority.LOW]: `Low`,
  [Priority.MEDIUM]: `Medium`,
}

export const PriorityIcons = {
  [Priority.NONE]: NoPriorityIcon,
  [Priority.URGENT]: UrgentPriorityIcon,
  [Priority.HIGH]: HighPriorityIcon,
  [Priority.MEDIUM]: MediumPriorityIcon,
  [Priority.LOW]: LowPriorityIcon,
}

export const PriorityOptions: [
  React.FunctionComponent<React.SVGProps<SVGSVGElement>>,
  PriorityValue,
  string,
][] = [
  [PriorityIcons[Priority.NONE], Priority.NONE, `None`],
  [PriorityIcons[Priority.URGENT], Priority.URGENT, `Urgent`],
  [PriorityIcons[Priority.HIGH], Priority.HIGH, `High`],
  [PriorityIcons[Priority.MEDIUM], Priority.MEDIUM, `Medium`],
  [PriorityIcons[Priority.LOW], Priority.LOW, `Low`],
]

export const Status = {
  BACKLOG: `backlog`,
  TODO: `todo`,
  IN_PROGRESS: `in_progress`,
  DONE: `done`,
  CANCELED: `canceled`,
} as const

export type StatusValue = (typeof Status)[keyof typeof Status]

export const StatusDisplay = {
  [Status.BACKLOG]: `Backlog`,
  [Status.TODO]: `To Do`,
  [Status.IN_PROGRESS]: `In Progress`,
  [Status.DONE]: `Done`,
  [Status.CANCELED]: `Canceled`,
}

export const StatusIcons = {
  [Status.BACKLOG]: BacklogIcon,
  [Status.TODO]: TodoIcon,
  [Status.IN_PROGRESS]: InProgressIcon,
  [Status.DONE]: DoneIcon,
  [Status.CANCELED]: CancelIcon,
}

export const StatusOptions: [
  React.FunctionComponent<React.SVGProps<SVGSVGElement>>,
  StatusValue,
  string,
][] = [
  [StatusIcons[Status.BACKLOG], Status.BACKLOG, StatusDisplay[Status.BACKLOG]],
  [StatusIcons[Status.TODO], Status.TODO, StatusDisplay[Status.TODO]],
  [
    StatusIcons[Status.IN_PROGRESS],
    Status.IN_PROGRESS,
    StatusDisplay[Status.IN_PROGRESS],
  ],
  [StatusIcons[Status.DONE], Status.DONE, StatusDisplay[Status.DONE]],
  [
    StatusIcons[Status.CANCELED],
    Status.CANCELED,
    StatusDisplay[Status.CANCELED],
  ],
]
