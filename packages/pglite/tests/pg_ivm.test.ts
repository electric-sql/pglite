import { describe, it, expect } from 'vitest'
import { testEsmCjsAndDTC } from './test-utils.ts'

await testEsmCjsAndDTC(async (importType) => {
  const { PGlite } =
    importType === 'esm'
      ? await import('../dist/index.js')
      : ((await import(
          '../dist/index.cjs'
        )) as unknown as typeof import('../dist/index.js'))

  const { pg_ivm } =
    importType === 'esm'
      ? await import('../dist/pg_ivm/index.js')
      : ((await import(
          '../dist/pg_ivm/index.cjs'
        )) as unknown as typeof import('../dist/pg_ivm/index.js'))

  describe(`pg_ivm`, () => {
    it('can load extension', async () => {
      const pg = new PGlite({
        extensions: {
          pg_ivm,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_ivm;')

      // Verify the extension is loaded
      const res = await pg.query<{ extname: string }>(`
        SELECT extname 
        FROM pg_extension 
        WHERE extname = 'pg_ivm'
      `)

      expect(res.rows).toHaveLength(1)
      expect(res.rows[0].extname).toBe('pg_ivm')
    })

    it('can create incremental materialized view', async () => {
      const pg = new PGlite({
        extensions: {
          pg_ivm,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_ivm;')

      // Create base table
      await pg.exec(`
        CREATE TABLE orders (
          id SERIAL PRIMARY KEY,
          customer_id INTEGER,
          amount DECIMAL(10,2),
          created_at TIMESTAMP DEFAULT NOW()
        );
      `)

      // Create incremental materialized view using correct syntax with dollar quoting
      await pg.exec(`
        SELECT pgivm.create_immv('order_summary', $$
          SELECT 
            customer_id,
            COUNT(*) as order_count,
            SUM(amount) as total_amount
          FROM orders 
          GROUP BY customer_id
        $$);
      `)

      // Commit to ensure view is created
      await pg.exec('COMMIT;')

      // Verify the view was created - check both pg_matviews and information_schema
      const res = await pg.query<{ table_name: string }>(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_name = 'order_summary' AND table_type = 'BASE TABLE'
      `)

      expect(res.rows).toHaveLength(1)
      expect(res.rows[0].table_name).toBe('order_summary')
    })

    it('automatically updates view when base table changes', async () => {
      const pg = new PGlite({
        extensions: {
          pg_ivm,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_ivm;')

      // Create base table
      await pg.exec(`
        CREATE TABLE products (
          id SERIAL PRIMARY KEY,
          category VARCHAR(50),
          price DECIMAL(10,2),
          quantity INTEGER
        );
      `)

      // Create incremental materialized view using dollar quoting
      await pg.exec(`
        SELECT pgivm.create_immv('category_stats', $$
          SELECT 
            category,
            COUNT(*) as product_count,
            SUM(price * quantity) as total_value,
            AVG(price) as avg_price
          FROM products 
          GROUP BY category
        $$);
      `)

      // Initially, view should be empty
      let viewData = await pg.query(
        `SELECT * FROM category_stats ORDER BY category;`,
      )
      expect(viewData.rows).toHaveLength(0)

      // Insert some data
      await pg.exec(`
        INSERT INTO products (category, price, quantity) VALUES 
        ('electronics', 100.00, 10),
        ('electronics', 200.00, 5),
        ('books', 15.00, 20),
        ('books', 25.00, 8);
      `)

      // Commit after inserts
      await pg.exec('COMMIT;')

      // View should be automatically updated
      viewData = await pg.query<{
        category: string
        product_count: number
        total_value: string
        avg_price: string
      }>(`SELECT * FROM category_stats ORDER BY category;`)
      expect(viewData.rows).toHaveLength(2)

      const electronicsRow = viewData.rows.find(
        (row: any) => row.category === 'electronics',
      ) as any
      const booksRow = viewData.rows.find(
        (row: any) => row.category === 'books',
      ) as any

      expect(electronicsRow).toBeDefined()
      expect(electronicsRow.product_count).toBe(2)
      expect(Number(electronicsRow.total_value)).toBe(2000.0) // 100*10 + 200*5
      expect(Number(electronicsRow.avg_price)).toBe(150.0) // (100+200)/2

      expect(booksRow).toBeDefined()
      expect(booksRow.product_count).toBe(2)
      expect(Number(booksRow.total_value)).toBe(500.0) // 15*20 + 25*8
      expect(Number(booksRow.avg_price)).toBe(20.0) // (15+25)/2

      // Update existing data
      await pg.exec(
        `UPDATE products SET quantity = 15 WHERE category = 'electronics' AND price = 100.00;`,
      )

      // View should reflect the update
      viewData = await pg.query<{
        category: string
        product_count: number
        total_value: string
        avg_price: string
      }>(`SELECT * FROM category_stats WHERE category = 'electronics';`)
      expect(viewData.rows).toHaveLength(1)
      expect(Number((viewData.rows[0] as any).total_value)).toBe(2500.0) // 100*15 + 200*5

      // Insert more data
      await pg.exec(
        `INSERT INTO products (category, price, quantity) VALUES ('electronics', 300.00, 3);`,
      )

      // View should include new data
      viewData = await pg.query<{
        category: string
        product_count: number
        total_value: string
        avg_price: string
      }>(`SELECT * FROM category_stats WHERE category = 'electronics';`)
      expect(viewData.rows).toHaveLength(1)
      expect((viewData.rows[0] as any).product_count).toBe(3)
      expect(Number((viewData.rows[0] as any).total_value)).toBe(3400.0) // 100*15 + 200*5 + 300*3
      expect(Number((viewData.rows[0] as any).avg_price)).toBe(200.0) // (100+200+300)/3

      // Delete data
      await pg.exec(
        `DELETE FROM products WHERE category = 'electronics' AND price = 300.00;`,
      )

      // View should reflect the deletion
      viewData = await pg.query<{
        category: string
        product_count: number
        total_value: string
        avg_price: string
      }>(`SELECT * FROM category_stats WHERE category = 'electronics';`)
      expect(viewData.rows).toHaveLength(1)
      expect((viewData.rows[0] as any).product_count).toBe(2)
      expect(Number((viewData.rows[0] as any).total_value)).toBe(2500.0) // 100*15 + 200*5
    })

    it('supports simple views without aggregates', async () => {
      const pg = new PGlite({
        extensions: {
          pg_ivm,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_ivm;')

      // Create base tables
      await pg.exec(`
        CREATE TABLE users (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100),
          status VARCHAR(20)
        );
      `)

      await pg.exec(`
        CREATE TABLE user_profiles (
          user_id INTEGER,
          email VARCHAR(100),
          age INTEGER
        );
      `)

      // Create incremental materialized view with join using dollar quoting
      await pg.exec(`
        SELECT pgivm.create_immv('active_users', $$
          SELECT 
            u.id,
            u.name,
            p.email,
            p.age
          FROM users u
          JOIN user_profiles p ON u.id = p.user_id
          WHERE u.status = 'active'
        $$);
      `)

      // Insert test data
      await pg.exec(`
        INSERT INTO users (name, status) VALUES 
        ('Alice', 'active'),
        ('Bob', 'inactive'),
        ('Charlie', 'active');
      `)

      await pg.exec(`
        INSERT INTO user_profiles (user_id, email, age) VALUES 
        (1, 'alice@example.com', 25),
        (2, 'bob@example.com', 30),
        (3, 'charlie@example.com', 35);
      `)

      // Check the view content
      let viewData = await pg.query<{
        id: number
        name: string
        email: string
        age: number
      }>(`SELECT * FROM active_users ORDER BY id;`)
      expect(viewData.rows).toHaveLength(2)
      expect(viewData.rows[0].name).toBe('Alice')
      expect(viewData.rows[1].name).toBe('Charlie')

      // Update user status
      await pg.exec(`UPDATE users SET status = 'active' WHERE name = 'Bob';`)

      // View should now include Bob
      viewData = await pg.query<{
        id: number
        name: string
        email: string
        age: number
      }>(`SELECT * FROM active_users ORDER BY id;`)
      expect(viewData.rows).toHaveLength(3)
      expect(viewData.rows[1].name).toBe('Bob')

      // Delete a user profile
      await pg.exec(`DELETE FROM user_profiles WHERE user_id = 1;`)

      // Alice should no longer appear in the view
      viewData = await pg.query<{
        id: number
        name: string
        email: string
        age: number
      }>(`SELECT * FROM active_users ORDER BY id;`)
      expect(viewData.rows).toHaveLength(2)
      expect(viewData.rows.every((row) => row.name !== 'Alice')).toBe(true)
    })

    it('supports DISTINCT in views', async () => {
      const pg = new PGlite({
        extensions: {
          pg_ivm,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_ivm;')

      // Create base table with potential duplicates
      await pg.exec(`
        CREATE TABLE events (
          id SERIAL PRIMARY KEY,
          event_type VARCHAR(50),
          user_id INTEGER,
          timestamp TIMESTAMP DEFAULT NOW()
        );
      `)

      // Create incremental materialized view with DISTINCT using dollar quoting
      await pg.exec(`
        SELECT pgivm.create_immv('unique_event_types', $$
          SELECT DISTINCT event_type FROM events
        $$);
      `)

      // Insert some events with duplicates
      await pg.exec(`
        INSERT INTO events (event_type, user_id) VALUES 
        ('login', 1),
        ('login', 2),
        ('logout', 1),
        ('purchase', 3),
        ('login', 3),
        ('logout', 2);
      `)

      // View should only contain unique event types
      let viewData = await pg.query<{ event_type: string }>(
        `SELECT * FROM unique_event_types ORDER BY event_type;`,
      )
      expect(viewData.rows).toHaveLength(3)
      expect(viewData.rows.map((row) => row.event_type)).toEqual([
        'login',
        'logout',
        'purchase',
      ])

      // Add a new unique event type
      await pg.exec(
        `INSERT INTO events (event_type, user_id) VALUES ('signup', 4);`,
      )

      // View should include the new event type
      viewData = await pg.query<{ event_type: string }>(
        `SELECT * FROM unique_event_types ORDER BY event_type;`,
      )
      expect(viewData.rows).toHaveLength(4)
      expect(viewData.rows.map((row) => row.event_type)).toEqual([
        'login',
        'logout',
        'purchase',
        'signup',
      ])

      // Add more of existing event type (should not change view)
      await pg.exec(
        `INSERT INTO events (event_type, user_id) VALUES ('login', 5);`,
      )

      viewData = await pg.query<{ event_type: string }>(
        `SELECT * FROM unique_event_types ORDER BY event_type;`,
      )
      expect(viewData.rows).toHaveLength(4)
    })

    it('can use refresh_immv function', async () => {
      const pg = new PGlite({
        extensions: {
          pg_ivm,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_ivm;')

      // Create base table
      await pg.exec(`
        CREATE TABLE items (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100),
          price DECIMAL(10,2)
        );
      `)

      // Create IMMV using dollar quoting
      await pg.exec(`
        SELECT pgivm.create_immv('item_summary', $$
          SELECT COUNT(*) as total_items, AVG(price) as avg_price FROM items
        $$);
      `)

      // Insert initial data
      await pg.exec(
        `INSERT INTO items (name, price) VALUES ('item1', 10.00), ('item2', 20.00);`,
      )

      // Check initial view state
      let viewData = await pg.query<{ total_items: number; avg_price: string }>(
        `SELECT * FROM item_summary;`,
      )
      expect(viewData.rows).toHaveLength(1)
      expect(viewData.rows[0].total_items).toBe(2)
      expect(Number(viewData.rows[0].avg_price)).toBe(15.0)

      // Test refresh_immv function
      await pg.exec(`SELECT pgivm.refresh_immv('item_summary', true);`)

      // View should still have the same data after refresh
      viewData = await pg.query<{ total_items: number; avg_price: string }>(
        `SELECT * FROM item_summary;`,
      )
      expect(viewData.rows).toHaveLength(1)
      expect(viewData.rows[0].total_items).toBe(2)
      expect(Number(viewData.rows[0].avg_price)).toBe(15.0)
    })
  })
})
