import { usePGlite } from "@electric-sql/pglite-react"
import MyPGliteItemsComponent from "./MyPGliteItemsComponent"

const names = ['Arthur', 'Valter', 'Sam', 'Paul', 'Stefanos', 'Rob', 'Gary', 'Kyle', 'Kevin', 'Tudor']

function MyPGliteComponent() {
  try {

    // see details https://pglite.dev/docs/framework-hooks/react#usepglite
    const db = usePGlite()
    
    const insertRow = async () => {
      const name = names[Math.floor(Math.random() * names.length)];
      const value = Math.floor(Math.random() * 1000)

      console.log(`Inserting name = ${name} with value=${value} into pglite`)
      
      // see details https://pglite.dev/docs/api#query
      const result = await db.query('INSERT INTO my_table (name, number) VALUES ($1, $2);', [name, value])

      console.log (`Inserted into pglite ${result.affectedRows} rows.`)
    }

    return (
      <>
      <div className="card">
        <button onClick={insertRow}>Insert row</button>
        <MyPGliteItemsComponent key="pgliteItems" ></MyPGliteItemsComponent>
      </div>
    </>
  )
  } catch {
    return <></>
  }
}

export default MyPGliteComponent