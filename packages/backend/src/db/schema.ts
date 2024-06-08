import {
	pgTable,
	serial,
	text,
	timestamp,
	customType,
} from "drizzle-orm/pg-core";

const vector = customType<{
	data: unknown[];
	driverData: string;
	config: {
		dimensions?: number;
	};
}>({
	dataType: (config) => {
		const dimensions = config?.dimensions ?? 3;
		return `vector(${dimensions})`;
	},
	toDriver: (value) => JSON.stringify(value),
	fromDriver: (value) => JSON.parse(value),
});

export const documents = pgTable("documents", {
	id: serial("id").primaryKey(),
	name: text("name").notNull(),
	createdAt: timestamp("created_at").defaultNow(),
});

export const documentSections = pgTable("document_sections", {
	id: serial("id").primaryKey(),
	documentId: serial("document_id").references(() => documents.id, {
		onDelete: "cascade",
	}),
	content: text("content").notNull(),
	embedding: vector("embedding", { dimensions: 1536 }).notNull(),
});
