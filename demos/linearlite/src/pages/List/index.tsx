import { useLiveQuery } from '@electric-sql/pglite-react'
import { LiveQuery } from '@electric-sql/pglite/live'
import { useLoaderData } from 'react-router-dom'
import { type ListOnItemsRenderedProps } from 'react-window'
import TopFilter from '../../components/TopFilter'
import IssueList from './IssueList'
import { Issue } from '../../types/types'
import { FilterState } from '../../utils/filterState'
const CHUNK_SIZE = 50

function calculateWindow(
  startIndex: number,
  stopIndex: number
): { offset: number; limit: number } {
  const offset = Math.max(
    0,
    Math.floor(startIndex / CHUNK_SIZE) * CHUNK_SIZE - CHUNK_SIZE
  )
  const endOffset = Math.ceil(stopIndex / CHUNK_SIZE) * CHUNK_SIZE + CHUNK_SIZE
  const limit = endOffset - offset
  return { offset, limit }
}

function List({ showSearch = false }) {
  const { liveIssues, filterState } = useLoaderData() as {
    liveIssues: LiveQuery<Issue>
    filterState: FilterState
  }

  const issuesRes = useLiveQuery(liveIssues)
  const offset = liveIssues.initialResults.offset ?? issuesRes.offset ?? 0
  const limit = liveIssues.initialResults.limit ?? issuesRes.limit ?? CHUNK_SIZE
  const issues = issuesRes?.rows

  const updateOffsetAndLimit = (itemsRendered: ListOnItemsRenderedProps) => {
    const { offset: newOffset, limit: newLimit } = calculateWindow(
      itemsRendered.overscanStartIndex,
      itemsRendered.overscanStopIndex
    )
    if (newOffset !== offset || newLimit !== limit) {
      liveIssues.refresh(newOffset, newLimit)
    }
  }

  const currentTotalCount = issuesRes.totalCount ?? issuesRes.rows.length
  const currentOffset = issuesRes.offset ?? 0
  const filledItems = new Array(currentTotalCount).fill(null)
  issues.forEach((issue, index) => {
    filledItems[index + currentOffset] = issue
  })

  return (
    <div className="flex flex-col flex-grow">
      <TopFilter
        filterState={filterState}
        filteredIssuesCount={issuesRes.totalCount ?? issuesRes.rows.length}
        showSearch={showSearch}
      />
      <IssueList
        onItemsRendered={(itemsRendered) => updateOffsetAndLimit(itemsRendered)}
        issues={filledItems}
      />
    </div>
  )
}

export default List
