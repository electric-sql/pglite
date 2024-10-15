import { z } from 'zod'

export const issueChangeSchema = z.object({
  id: z.string(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  priority: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  modified: z.string().nullable().optional(),
  created: z.string().nullable().optional(),
  kanbanorder: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  modified_columns: z.array(z.string()).nullable().optional(),
  deleted: z.boolean().nullable().optional(),
  new: z.boolean().nullable().optional(),
})

export type IssueChange = z.infer<typeof issueChangeSchema>

export const commentChangeSchema = z.object({
  id: z.string(),
  body: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  issue_id: z.string().nullable().optional(),
  modified: z.string().nullable().optional(),
  created: z.string().nullable().optional(),
  modified_columns: z.array(z.string()).nullable().optional(),
  deleted: z.boolean().nullable().optional(),
  new: z.boolean().nullable().optional(),
})

export type CommentChange = z.infer<typeof commentChangeSchema>

export const changeSetSchema = z.object({
  issues: z.array(issueChangeSchema),
  comments: z.array(commentChangeSchema),
})

export type ChangeSet = z.infer<typeof changeSetSchema>
