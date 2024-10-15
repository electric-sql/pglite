import TopFilter from '../../components/TopFilter'
import IssueBoard from './IssueBoard'
import { useFilterState } from '../../utils/filterState'
import { Issue } from '../../types/types'
import { useLiveQuery } from '@electric-sql/pglite-react'

function Board() {
  const [_filterState] = useFilterState()
  const issuesResults = useLiveQuery<Issue>(
    `SELECT * FROM issue WHERE deleted = false`
  )
  const issues = issuesResults?.rows ?? []
  // TODO: apply filter state

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopFilter
        title="Board"
        filteredIssuesCount={issues.length}
        hideSort={true}
      />
      <IssueBoard issues={issues} />
    </div>
  )
}

export default Board
