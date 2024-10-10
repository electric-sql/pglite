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
  changed_columns: z.array(z.string()).nullable().optional(),
  is_new: z.boolean(),
  is_deleted: z.boolean().nullable().optional(),
})

export type IssueChange = z.infer<typeof issueChangeSchema>

export const commentChangeSchema = z.object({
  id: z.string(),
  body: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  issue_id: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  changed_columns: z.array(z.string()).nullable().optional(),
  is_new: z.boolean(),
  is_deleted: z.boolean().nullable().optional(),
})

export type CommentChange = z.infer<typeof commentChangeSchema>

export const changeSetSchema = z.object({
  issues: z.array(issueChangeSchema),
  comments: z.array(commentChangeSchema),
})

export type ChangeSet = z.infer<typeof changeSetSchema>

export type RowChange = {
  id: string
  version: number
}

export type ChangeResponse = {
  issueVersions: RowChange[]
  commentVersions: RowChange[]
}
