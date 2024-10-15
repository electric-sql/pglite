import { faker } from '@faker-js/faker'
import { generateNKeysBetween } from 'fractional-indexing'
import { v4 as uuidv4 } from 'uuid'

export function generateIssues(numIssues) {
  // generate properly spaced kanban keys and shuffle them
  const kanbanKeys = faker.helpers.shuffle(
    generateNKeysBetween(null, null, numIssues)
  )
  return Array.from({ length: numIssues }, (_, idx) =>
    generateIssue(kanbanKeys[idx])
  )
}

function generateIssue(kanbanKey) {
  const issueId = uuidv4()
  const createdAt = faker.date.past()
  return {
    id: issueId,
    title: faker.lorem.sentence({ min: 3, max: 8 }),
    description: faker.lorem.sentences({ min: 2, max: 6 }, `\n`),
    priority: faker.helpers.arrayElement([`none`, `low`, `medium`, `high`]),
    status: faker.helpers.arrayElement([
      `backlog`,
      `todo`,
      `in_progress`,
      `done`,
      `canceled`,
    ]),
    created: createdAt.toISOString(),
    modified: faker.date
      .between({ from: createdAt, to: new Date() })
      .toISOString(),
    kanbanorder: kanbanKey,
    username: faker.internet.userName(),
    comments: faker.helpers.multiple(
      () => generateComment(issueId, createdAt),
      { count: faker.number.int({ min: 0, max: 10 }) }
    ),
  }
}

function generateComment(issueId, issueCreatedAt) {
  const createdAt = faker.date.between({ from: issueCreatedAt, to: new Date() })
  return {
    id: uuidv4(),
    body: faker.lorem.text(),
    username: faker.internet.userName(),
    issue_id: issueId,
    created: createdAt.toISOString(),
    modified: createdAt.toISOString(), // comments are never modified
  }
}
