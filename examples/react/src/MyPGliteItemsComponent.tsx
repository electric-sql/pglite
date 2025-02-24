import { useLiveQuery } from '@electric-sql/pglite-react'

function MyPGliteItemsComponent() {
  const maxNumber = 1000

  // see details https://pglite.dev/docs/framework-hooks/react#uselivequery
  const items = useLiveQuery(
    `
    SELECT id, name, number, "insertDateTime"
    FROM my_table
    WHERE number <= $1
    ORDER BY "insertDateTime" DESC
    FETCH FIRST 5 ROWS ONLY
  `,
    [maxNumber],
  )

  console.log(items)

  if (!items || items.rows.length === 0) return <></>

  return (
    <>
      <div className="card">
        <table style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>id</th>
              <th>Name</th>
              <th>Value</th>
              <th>Inserted</th>
            </tr>
          </thead>
          <tbody>
            {items?.rows.map((i) => (
              <tr key={(i.insertDateTime as Date).getTime()}>
                <td>{i.id as any}</td>
                <td>{i.name as any}</td>
                <td>{i.number as any}</td>
                <td>{(i.insertDateTime as Date).toString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

export default MyPGliteItemsComponent
