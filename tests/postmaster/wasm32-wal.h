#include "postgres.h"
#include "replication/message.h"

/* Native diagnostic tools must decode the server's wasm32 Size fields. */
typedef struct PglWasm32LogicalMessage
{
	Oid dbId;
	uint8 transactional;
	uint8 padding[3];
	uint32 prefix_size;
	uint32 message_size;
	char message[FLEXIBLE_ARRAY_MEMBER];
} PglWasm32LogicalMessage;

StaticAssertDecl(offsetof(PglWasm32LogicalMessage, message) == 16,
				 "unexpected wasm32 logical-message WAL layout");
#define xl_logical_message PglWasm32LogicalMessage
