import { useLiveQuery } from '@electric-sql/pglite-react'
import TopFilter from '../../components/TopFilter'
import IssueList from './IssueList'
// import { useFilterState } from '../../utils/filterState'
import { Issue } from '../../types/types'
import { useFilterState } from '../../utils/filterState'

function List({ showSearch = false }) {
  const [filterState] = useFilterState()

  console.log(filterState)

  let i = 1
  const sqlWhere = []
  const sqlParams = []
  if (filterState.status?.length) {
    sqlWhere.push(
      `status IN (${filterState.status.map(() => `$${i++}`).join(' ,')})`
    )
    sqlParams.push(...filterState.status)
  }
  if (filterState.priority?.length) {
    sqlWhere.push(
      `priority IN (${filterState.priority.map(() => `$${i++}`).join(' ,')})`
    )
    sqlParams.push(...filterState.priority)
  }
  if (filterState.query) {
    sqlWhere.push(`title ILIKE $${i++}`)
    sqlParams.push(filterState.query)
  }
  const sql = `
    SELECT * FROM issue
    ${sqlWhere.length ? `WHERE ${sqlWhere.join(' AND ')}` : ''}
    ORDER BY ${filterState.orderBy} ${filterState.orderDirection}
  `
  console.log(sql)
  const issueResults = useLiveQuery<Issue>(sql, sqlParams)
  const issues = issueResults?.rows

  if (!issues) {
    return <div className="p-8 w-full text-center">Loading...</div>
  }

  return (
    <div className="flex flex-col flex-grow">
      <TopFilter issues={issues} showSearch={showSearch} />
      <IssueList issues={issues} />
    </div>
  )
}

export default List
