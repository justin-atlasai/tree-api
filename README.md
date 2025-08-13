# Tree Nodes App

A full stack application to manage hierarchical tree data structures with Supabase as the backend. The app provides both a REST API and a frontend interface for viewing and adding tree nodes.

## Features

- Display all tree structures stored in the Supabase database.
- Add new nodes to any existing tree by specifying a parent node ID and a label.
- Persistent storage with Supabase Postgres.
- Server-side API built in TypeScript.
- API endpoints for retrieving and inserting tree data.
- Includes automated tests to ensure correct API behavior.

## Table of Contents

- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Database Schema](#database-schema)
- [API Endpoints](#api-endpoints)
- [Frontend Changes](#frontend-changes)
- [Testing](#testing)

---

## Tech Stack

- **Backend**: Node.js with TypeScript
- **Database**: Supabase Postgres
- **Frontend**: Next.js (Tree Nodes page)
- **Linting**: ESLint
- **Testing**: Jest
- **Hosting**: Supabase for database and API hosting

---

## Getting Started

1. **Clone the repository**

   ```bash
   git clone <repo-url>
   cd <repo-name>
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Set up environment variables**
   Create a `.env` file in the project root:

   ```
   SUPABASE_URL=<your-supabase-url>
   SUPABASE_KEY=<your-supabase-key>
   ```

4. **Run database migrations**
   Connect to Supabase and run the SQL from the [Database Schema](#database-schema) section.

5. **Start the development server**

   ```bash
   npm run dev
   ```

---

## Database Schema

```sql
create table tree_nodes (
  id bigserial primary key,
  label text not null,
  parent_id bigint references tree_nodes(id) on delete cascade
);
```

### Sample Data

```sql
insert into tree_nodes (label, parent_id) values
  ('root', null),
  ('bear', 1),
  ('cat', 2),
  ('frog', 1);
```

---

## API Endpoints

### GET `/api/tree`

Returns all trees in nested JSON format.

**Example Response**

```json
[
  {
    "id": 1,
    "label": "root",
    "children": [
      {
        "id": 3,
        "label": "bear",
        "children": [
          {
            "id": 4,
            "label": "cat",
            "children": []
          }
        ]
      },
      {
        "id": 7,
        "label": "frog",
        "children": []
      }
    ]
  }
]
```

### POST `/api/tree`

Creates a new node and attaches it to a parent node.

**Request Body**

```json
{
  "label": "cat’s child",
  "parentId": 4
}
```

**Example SQL**

```sql
insert into tree_nodes (label, parent_id)
values ('cat’s child', 4)
returning *;
```

---

## Frontend Changes

### Tree Nodes Page

- **New Button**: Fetch all trees from the database and display them.
- **Add Node Section**: Two input fields:
  1. **Parent ID**: Numeric ID of the parent node.
  2. **Label**: Label for the new node.

- **Submit Button**: Sends a POST request to `/api/tree` to create the new node.

---

## Testing

- Unit tests for API endpoints to verify correct data retrieval and insertion.
- Integration tests to ensure the tree structure is returned in proper nested format.
- Example:
  - `GET /api/tree` returns correct hierarchy.
  - `POST /api/tree` inserts node and links to parent.

Run tests:

```bash
npm run test
```

---

## License

MIT License
