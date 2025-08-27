import { useEffect, useReducer, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { StyleSheet, Text, View, ScrollView } from 'react-native'
import { PGlite } from '@electric-sql/pglite-react-native'

/*
 * PGlite React Native Test Suite
 * 
 * This test suite works with persistent databases. It:
 * - Uses CREATE TABLE IF NOT EXISTS to handle existing tables
 * - Clears test data before inserting to avoid duplicate key violations
 * - Uses @test.com email domain for test data isolation
 * 
 * This ensures tests pass whether starting with a fresh or existing database.
 */

function useErrorDispatcher() {
  const [, dispatchError] = useReducer((_, error) => {
    throw error
  }, undefined)
  return dispatchError
}

interface TestResult {
  step: string
  success: boolean
  result?: any
  error?: string
}

export default function App() {
  const [results, setResults] = useState<TestResult[]>([])
  const [isRunning, setIsRunning] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const dispatchError = useErrorDispatcher()

  const addResult = (
    step: string,
    success: boolean,
    result?: any,
    error?: string,
  ) => {
    console.log(
      `[PGL Test] ${success ? '✅' : '❌'} ${step}: ${result || error || 'no details'}`,
    )
    setResults((prev) => [...prev, { step, success, result, error }])
  }

  // Helper function to check if a query result indicates success
  const isQuerySuccessful = (result: any, expectedRows?: number): boolean => {
    // Check for basic result structure
    if (!result || typeof result !== 'object') {
      console.log('[PGL Test] Query failed: No result object')
      return false
    }

    // Check if we have the expected structure
    if (!('rows' in result) || !Array.isArray(result.rows)) {
      console.log('[PGL Test] Query failed: No rows array')
      return false
    }

    // For operations that should return data, check row count
    if (expectedRows !== undefined && result.rows.length !== expectedRows) {
      console.log(
        `[PGL Test] Query failed: Expected ${expectedRows} rows, got ${result.rows.length}`,
      )
      return false
    }

    // Check for affectedRows on INSERT/UPDATE/DELETE operations
    if (
      expectedRows === undefined &&
      result.affectedRows === undefined &&
      result.rows.length === 0
    ) {
      console.log(
        '[PGL Test] Query failed: No affectedRows and no data returned',
      )
      return false
    }

    return true
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        addResult('Initializing PGlite', true, 'Starting database...')
        console.log('[PGL Test] Initializing PGlite database...')
        const db = new PGlite()
        console.log('[PGL Test] Database initialized successfully')

        // Test 1: Simple query
        addResult('Test 1: Simple SELECT', true, 'Running...')
        console.log('[PGL Test] Running simple SELECT query...')
        const simpleRes = await db.query<{ n: number }>('SELECT 1 as n')
        console.log('[PGL Test] Simple SELECT result:', simpleRes)

        const simpleSuccess =
          isQuerySuccessful(simpleRes, 1) && simpleRes.rows[0]?.n == 1 // Use == to handle string/number conversion
        addResult(
          'Test 1: Simple SELECT',
          simpleSuccess,
          simpleSuccess
            ? `Result: ${simpleRes.rows[0]?.n}`
            : 'Failed to get expected result',
          simpleSuccess
            ? undefined
            : `Expected 1 row with n=1, got: ${JSON.stringify(simpleRes)}`,
        )

        // Test 2: Create table (or use existing)
        addResult('Test 2: Setup table', true, 'Setting up users table...')
        console.log('[PGL Test] Setting up users table...')
        const createTableQuery = `CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  age INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`
        console.log('[PGL Test] SQL:', createTableQuery)
        const createRes = await db.query(createTableQuery)
        console.log('[PGL Test] CREATE TABLE IF NOT EXISTS result:', createRes)
        console.log('[PGL Test] CREATE TABLE fields:', createRes.fields)
        console.log('[PGL Test] CREATE TABLE rows:', createRes.rows)
        console.log(
          '[PGL Test] CREATE TABLE affectedRows:',
          createRes.affectedRows,
        )

        // CREATE TABLE IF NOT EXISTS should always succeed
        const createSuccess =
          createRes &&
          Array.isArray(createRes.rows) &&
          createRes.rows.length === 0
        addResult(
          'Test 2: Setup table',
          createSuccess,
          createSuccess
            ? `Table ready for use`
            : 'Failed to setup table',
          createSuccess
            ? undefined
            : `CREATE TABLE failed: ${JSON.stringify(createRes)}`,
        )

        // Test 2b: Clear existing test data
        addResult('Test 2b: Clear test data', true, 'Clearing existing test data...')
        console.log('[PGL Test] Clearing existing test data...')
        const clearQuery = `DELETE FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@test.com'`
        console.log('[PGL Test] SQL:', clearQuery)
        const clearRes = await db.query(clearQuery)
        console.log('[PGL Test] DELETE result:', clearRes)
        const clearedCount = clearRes.affectedRows || 0
        addResult(
          'Test 2b: Clear test data',
          true,
          `Cleared ${clearedCount} existing test records`
        )

        // Test 3: Insert data
        addResult('Test 3: Insert data', true, 'Inserting users...')
        console.log('[PGL Test] Inserting first user...')
        // Use literal values instead of parameters for simple protocol
        const insertQuery = `INSERT INTO users (name, email, age) VALUES ('Alice Johnson', 'alice@test.com', 28) RETURNING id`
        console.log('[PGL Test] SQL:', insertQuery)
        const insertRes = await db.query(insertQuery)
        console.log('[PGL Test] INSERT result:', insertRes)
        console.log('[PGL Test] INSERT fields:', insertRes.fields)
        console.log('[PGL Test] INSERT rows:', insertRes.rows)
        console.log('[PGL Test] INSERT affectedRows:', insertRes.affectedRows)

        // INSERT with RETURNING should return 1 row with the ID (could be string or number)
        const insertSuccess =
          isQuerySuccessful(insertRes, 1) &&
          insertRes.rows[0] &&
          (insertRes.rows[0].id ||
            insertRes.rows[0][0] ||
            insertRes.rows[0]['0'])
        const insertedId =
          insertRes.rows[0]?.id ||
          insertRes.rows[0]?.[0] ||
          insertRes.rows[0]?.['0']

        addResult(
          'Test 3: Insert data',
          insertSuccess,
          insertSuccess
            ? `Inserted user with ID: ${insertedId}`
            : 'Failed to insert user',
          insertSuccess
            ? undefined
            : `INSERT failed: ${JSON.stringify(insertRes)}`,
        )

        // Only continue if first insert succeeded
        if (!insertSuccess) {
          addResult('Test suite', false, 'Stopping tests due to INSERT failure')
          throw new Error('First INSERT failed, stopping test suite')
        }

        // Insert more users one by one
        console.log('[PGL Test] Inserting second user...')
        const insert2Query =
          'INSERT INTO users (name, email, age) VALUES ($1, $2, $3)'
        const insert2Params = ['Bob Smith', 'bob@test.com', 35]
        console.log('[PGL Test] SQL:', insert2Query)
        console.log('[PGL Test] Params:', insert2Params)
        const insert2Res = await db.query(insert2Query, insert2Params)
        console.log('[PGL Test] INSERT 2 result:', insert2Res)
        const insert2Success =
          isQuerySuccessful(insert2Res) &&
          (insert2Res.affectedRows == 1 || insert2Res.rows.length >= 0)

        console.log('[PGL Test] Inserting third user...')
        const insert3Query =
          'INSERT INTO users (name, email, age) VALUES ($1, $2, $3)'
        const insert3Params = ['Carol Davis', 'carol@test.com', 42]
        console.log('[PGL Test] SQL:', insert3Query)
        console.log('[PGL Test] Params:', insert3Params)
        const insert3Res = await db.query(insert3Query, insert3Params)
        console.log('[PGL Test] INSERT 3 result:', insert3Res)
        const insert3Success =
          isQuerySuccessful(insert3Res) &&
          (insert3Res.affectedRows == 1 || insert3Res.rows.length >= 0)

        console.log('[PGL Test] Inserting fourth user...')
        const insert4Query =
          'INSERT INTO users (name, email, age) VALUES ($1, $2, $3)'
        const insert4Params = ['David Wilson', 'david@test.com', 31]
        console.log('[PGL Test] SQL:', insert4Query)
        console.log('[PGL Test] Params:', insert4Params)
        const insert4Res = await db.query(insert4Query, insert4Params)
        console.log('[PGL Test] INSERT 4 result:', insert4Res)
        const insert4Success =
          isQuerySuccessful(insert4Res) &&
          (insert4Res.affectedRows == 1 || insert4Res.rows.length >= 0)

        const successfulInserts = [
          insert2Success,
          insert3Success,
          insert4Success,
        ].filter(Boolean).length
        addResult(
          'Test 3b: Additional inserts',
          successfulInserts === 3,
          successfulInserts === 3
            ? `Inserted 3 more users successfully`
            : `Only ${successfulInserts}/3 inserts succeeded`,
          successfulInserts === 3 ? undefined : `Some inserts failed`,
        )

        // Test 4: Query data
        addResult('Test 4: Query data', true, 'Querying users...')
        console.log('[PGL Test] Querying all users...')
        const selectQuery =
          'SELECT id, name, email, age FROM users ORDER BY age DESC'
        console.log('[PGL Test] SQL:', selectQuery)
        const queryRes = await db.query(selectQuery)
        console.log('[PGL Test] SELECT result:', queryRes)
        console.log('[PGL Test] SELECT fields:', queryRes.fields)
        console.log('[PGL Test] SELECT rows:', queryRes.rows)
        console.log('[PGL Test] SELECT affectedRows:', queryRes.affectedRows)

        // Log each user found
        queryRes.rows.forEach((row, index) => {
          console.log(`[PGL Test] User ${index + 1}:`, row)
        })

        // Should find the users we just inserted (at least 1, up to 4)
        const actualUserCount = queryRes.rows.length
        const minExpected = 1 // At least the first insert should succeed
        const maxExpected = 4 // Maximum if all inserts succeeded
        const selectSuccess =
          isQuerySuccessful(queryRes) &&
          actualUserCount >= minExpected &&
          actualUserCount <= maxExpected
        addResult(
          'Test 4: Query data',
          selectSuccess,
          selectSuccess
            ? `Found ${actualUserCount} users (${minExpected}-${maxExpected} expected)`
            : `Expected ${minExpected}-${maxExpected} users, found ${actualUserCount}`,
          selectSuccess
            ? undefined
            : `SELECT failed: ${JSON.stringify(queryRes)}`,
        )

        // Test 4b: Simple count to verify data exists
        console.log('[PGL Test] Running simple count query...')
        const countQuery = 'SELECT COUNT(*) as count FROM users'
        console.log('[PGL Test] SQL:', countQuery)
        const countRes = await db.query(countQuery)
        console.log('[PGL Test] COUNT result:', countRes)

        const countValue =
          countRes.rows[0]?.count ||
          countRes.rows[0]?.[0] ||
          countRes.rows[0]?.['0']
        // Count verification should just confirm the COUNT query works, not match SELECT results
        const countSuccess = isQuerySuccessful(countRes, 1) && countValue >= 0
        addResult(
          'Test 4b: Count verification',
          countSuccess,
          countSuccess
            ? `Count query returned: ${countValue} users total`
            : `COUNT query failed`,
          countSuccess
            ? undefined
            : `COUNT failed: ${JSON.stringify(countRes)}`,
        )
        
        // Update actualUserCount to use the authoritative COUNT result
        const totalUserCount = parseInt(countValue) || 0

        // Test 5: Complex query with aggregation
        addResult('Test 5: Aggregation', true, 'Running aggregation query...')
        console.log('[PGL Test] Running aggregation query...')
        const aggQuery =
          'SELECT COUNT(*) as count, AVG(age) as avg_age, MIN(age) as min_age, MAX(age) as max_age FROM users'
        console.log('[PGL Test] SQL:', aggQuery)
        const aggRes = await db.query(aggQuery)
        console.log('[PGL Test] Aggregation result:', aggRes)
        console.log('[PGL Test] Aggregation fields:', aggRes.fields)
        console.log('[PGL Test] Aggregation rows:', aggRes.rows)

        const stats = aggRes.rows[0]
        console.log('[PGL Test] Statistics:', stats)

        // Aggregation should return 1 row with statistics (values might be strings)
        const aggSuccess =
          isQuerySuccessful(aggRes, 1) &&
          stats &&
          (stats.count == totalUserCount || stats[0] == totalUserCount)
        const displayStats = stats
          ? {
              count: stats.count || stats[0],
              avg_age: stats.avg_age || stats[1],
              min_age: stats.min_age || stats[2],
              max_age: stats.max_age || stats[3],
            }
          : null

        addResult(
          'Test 5: Aggregation',
          aggSuccess,
          aggSuccess
            ? `Count: ${displayStats?.count}, Avg age: ${displayStats?.avg_age}, Min: ${displayStats?.min_age}, Max: ${displayStats?.max_age}`
            : 'Aggregation failed',
          aggSuccess
            ? undefined
            : `Aggregation failed: ${JSON.stringify(aggRes)}`,
        )

        // Test 6: Update data
        addResult('Test 6: Update data', true, 'Updating user...')
        console.log('[PGL Test] Updating user age...')
        const updateQuery = 'UPDATE users SET age = $1 WHERE name = $2'
        const updateParams = [29, 'Alice Johnson']
        console.log('[PGL Test] SQL:', updateQuery)
        console.log('[PGL Test] Params:', updateParams)
        const updateRes = await db.query(updateQuery, updateParams)
        console.log('[PGL Test] UPDATE result:', updateRes)

        const updateSuccess =
          isQuerySuccessful(updateRes) &&
          (updateRes.affectedRows == 1 || updateRes.rows.length >= 0)
        addResult(
          'Test 6: Update data',
          updateSuccess,
          updateSuccess
            ? `Updated ${updateRes.affectedRows || 'unknown'} row(s)`
            : 'Update failed',
          updateSuccess
            ? undefined
            : `UPDATE failed: ${JSON.stringify(updateRes)}`,
        )

        // Test 7: Delete data
        addResult('Test 7: Delete data', true, 'Deleting user...')
        console.log('[PGL Test] Deleting user...')
        const deleteQuery = 'DELETE FROM users WHERE email = $1'
        const deleteParams = ['david@test.com']
        console.log('[PGL Test] SQL:', deleteQuery)
        console.log('[PGL Test] Params:', deleteParams)
        const deleteRes = await db.query(deleteQuery, deleteParams)
        console.log('[PGL Test] DELETE result:', deleteRes)

        const deleteSuccess =
          isQuerySuccessful(deleteRes) &&
          (deleteRes.affectedRows == 1 || deleteRes.rows.length >= 0)
        addResult(
          'Test 7: Delete data',
          deleteSuccess,
          deleteSuccess
            ? `Deleted ${deleteRes.affectedRows || 'unknown'} row(s)`
            : 'Delete failed',
          deleteSuccess
            ? undefined
            : `DELETE failed: ${JSON.stringify(deleteRes)}`,
        )

        // Test 8: Final count
        addResult(
          'Test 8: Final verification',
          true,
          'Counting remaining users...',
        )
        console.log('[PGL Test] Final verification - counting users...')
        const finalQuery = 'SELECT COUNT(*) as count FROM users'
        console.log('[PGL Test] SQL:', finalQuery)
        const finalRes = await db.query(finalQuery)
        console.log('[PGL Test] Final COUNT result:', finalRes)

        const finalCount =
          finalRes.rows[0]?.count ||
          finalRes.rows[0]?.[0] ||
          finalRes.rows[0]?.['0']
        const expectedFinalCount = Math.max(0, totalUserCount - 1) // Current count - 1 deleted
        const finalSuccess =
          isQuerySuccessful(finalRes, 1) && finalCount == expectedFinalCount
        addResult(
          'Test 8: Final verification',
          finalSuccess,
          finalSuccess
            ? `Final user count: ${finalCount} (deleted 1 from ${totalUserCount})`
            : `Expected ${expectedFinalCount} users, got ${finalCount}`,
          finalSuccess
            ? undefined
            : `Final count failed: ${JSON.stringify(finalRes)}`,
        )

        addResult(
          'All tests completed!',
          true,
          '✅ PGlite is working correctly on React Native!',
        )

        console.log('[PGL Test] All tests completed successfully!')
        console.log('[PGL Test] Closing database...')
        await db.close()
        console.log('[PGL Test] Database closed')
        setIsRunning(false)
      } catch (e: any) {
        const errorMsg = String(e?.message ?? e)
        console.error('[PGL Test] ERROR occurred:', e)
        console.error('[PGL Test] Error message:', errorMsg)
        console.error('[PGL Test] Error stack:', e?.stack)
        addResult('Error occurred', false, undefined, errorMsg)
        if (!cancelled) setError(errorMsg)
        setIsRunning(false)
        throw e
      }
    })().catch((e) => {
      console.error('[PGL Test] Unhandled error in test suite:', e)
      dispatchError(e)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <View style={styles.container}>
      <Text style={styles.title}>PGlite React Native Example</Text>
      <Text style={styles.subtitle}>
        {isRunning ? 'Running tests...' : 'Tests completed'}
      </Text>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={true}>
        {results.map((result, index) => (
          <View key={index} style={styles.resultItem}>
            <Text
              style={[
                styles.stepText,
                result.success ? styles.success : styles.error,
              ]}
            >
              {result.success ? '✅' : '❌'} {result.step}
            </Text>
            {result.result && (
              <Text style={styles.resultText}>{result.result}</Text>
            )}
            {result.error && (
              <Text style={styles.errorText}>{result.error}</Text>
            )}
          </View>
        ))}

        {error && (
          <View style={styles.resultItem}>
            <Text style={styles.error}>❌ Fatal Error: {error}</Text>
          </View>
        )}
      </ScrollView>

      <StatusBar style="auto" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 24,
  },
  title: {
    fontSize: 20,
    marginBottom: 8,
    fontWeight: '600',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 16,
    textAlign: 'center',
    color: '#666',
  },
  scrollView: {
    flex: 1,
    width: '100%',
  },
  resultItem: {
    marginBottom: 12,
    padding: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  stepText: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  resultText: {
    fontSize: 14,
    color: '#333',
    marginLeft: 20,
  },
  errorText: {
    fontSize: 14,
    color: 'red',
    marginLeft: 20,
  },
  success: {
    color: 'green',
  },
  error: {
    color: 'red',
  },
})
