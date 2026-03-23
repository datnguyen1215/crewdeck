/**
 * Admiral Tool Definitions
 *
 * Defines the tools available to the Admiral LLM agent via Claude API tool calling.
 */
import type Anthropic from "@anthropic-ai/sdk";

export const ADMIRAL_TOOLS: Anthropic.Tool[] = [
  {
    name: "merge_pr",
    description: "Merge a pull request and delete the branch. Use when PR has passed all checks and is ready to merge.",
    input_schema: {
      type: "object" as const,
      properties: {
        issue_id: {
          type: "string",
          description: "The issue ID associated with the PR to merge",
        },
      },
      required: ["issue_id"],
    },
  },
  {
    name: "dispatch_captain",
    description: "Start or resume work on an issue by dispatching the Captain agent. Use to begin work on new issues or continue work on issues that need attention.",
    input_schema: {
      type: "object" as const,
      properties: {
        issue_id: {
          type: "string",
          description: "The issue ID to work on",
        },
        instructions: {
          type: "string",
          description: "Optional instructions for the Captain (e.g., 'Fix the merge conflicts', 'Address the review feedback')",
        },
      },
      required: ["issue_id"],
    },
  },
  {
    name: "create_issue",
    description: "Create a new issue in the project backlog.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Short, descriptive title for the issue",
        },
        description: {
          type: "string",
          description: "Detailed description of what needs to be done",
        },
      },
      required: ["title", "description"],
    },
  },
  {
    name: "update_issue",
    description: "Update an existing issue's fields.",
    input_schema: {
      type: "object" as const,
      properties: {
        issue_id: {
          type: "string",
          description: "The issue ID to update",
        },
        title: {
          type: "string",
          description: "New title for the issue",
        },
        description: {
          type: "string",
          description: "New description for the issue",
        },
        status: {
          type: "string",
          description: "New status (open, in_progress, pr_created, pr_conflict, pr_failed_actions, pr_ready_to_merge, done)",
        },
      },
      required: ["issue_id"],
    },
  },
  {
    name: "list_issues",
    description: "List issues in the project. Use to understand current project state and backlog.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "array",
          items: { type: "string" },
          description: "Filter by status(es). Options: open, in_progress, pr_created, pr_conflict, pr_failed_actions, pr_ready_to_merge, done",
        },
        limit: {
          type: "number",
          description: "Maximum number of issues to return (default: 20)",
        },
      },
    },
  },
  {
    name: "get_issue",
    description: "Get detailed information about a specific issue including comments and PR status.",
    input_schema: {
      type: "object" as const,
      properties: {
        issue_id: {
          type: "string",
          description: "The issue ID to retrieve",
        },
      },
      required: ["issue_id"],
    },
  },
  {
    name: "add_comment",
    description: "Add a comment to an issue. Use to communicate decisions or provide context.",
    input_schema: {
      type: "object" as const,
      properties: {
        issue_id: {
          type: "string",
          description: "The issue ID to comment on",
        },
        content: {
          type: "string",
          description: "The comment content (supports markdown)",
        },
      },
      required: ["issue_id", "content"],
    },
  },
  {
    name: "scan_codebase",
    description: "Trigger a codebase scan using the Librarian agent. Updates project knowledge entries.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "list_knowledge",
    description: "List knowledge entries for the project.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          description: "Filter by category (e.g., architecture, conventions, setup)",
        },
      },
    },
  },
  {
    name: "create_knowledge",
    description: "Create a new knowledge entry.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Title for the knowledge entry",
        },
        category: {
          type: "string",
          description: "Category (e.g., architecture, conventions, setup, workflows)",
        },
        content: {
          type: "string",
          description: "The knowledge content (supports markdown)",
        },
      },
      required: ["title", "category", "content"],
    },
  },
  {
    name: "update_knowledge",
    description: "Update an existing knowledge entry.",
    input_schema: {
      type: "object" as const,
      properties: {
        knowledge_id: {
          type: "string",
          description: "The knowledge entry ID to update",
        },
        title: {
          type: "string",
          description: "New title",
        },
        category: {
          type: "string",
          description: "New category",
        },
        content: {
          type: "string",
          description: "New content",
        },
      },
      required: ["knowledge_id"],
    },
  },
  {
    name: "delete_knowledge",
    description: "Delete a knowledge entry.",
    input_schema: {
      type: "object" as const,
      properties: {
        knowledge_id: {
          type: "string",
          description: "The knowledge entry ID to delete",
        },
      },
      required: ["knowledge_id"],
    },
  },
];
