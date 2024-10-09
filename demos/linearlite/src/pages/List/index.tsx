import { useLiveQuery } from '@electric-sql/pglite-react'
import { LiveQuery } from '@electric-sql/pglite/live'
import { useLoaderData } from 'react-router-dom'
import TopFilter from '../../components/TopFilter'
import IssueList from './IssueList'
import { Issue } from '../../types/types'

function List({ showSearch = false }) {
  const { liveIssues } = useLoaderData() as { liveIssues: LiveQuery<Issue> }
  const issues = useLiveQuery(liveIssues).rows
  return (
    <div className="flex flex-col flex-grow">
      <TopFilter issues={issues} showSearch={showSearch} />
      <IssueList issues={issues} />
    </div>
  )
}

export default List
