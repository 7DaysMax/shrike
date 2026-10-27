package db

import (
	"database/sql"
	"fmt"
)

type TaskBindingExistsError struct{ TaskID int64 }

func (e *TaskBindingExistsError) Error() string {
	return fmt.Sprintf("conversation already bound to task %d", e.TaskID)
}

// TaskConversation makes legacy task entry points join the same conversation.
// Deleting a conversation never deletes its task; a later open creates a new link.
func (d *DB) TaskConversation(taskID int64) (*Conversation, error) {
	tx, err := d.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var title string
	if err := tx.QueryRow(`SELECT COALESCE(NULLIF(name,''),description) FROM tasks WHERE id=$1 FOR UPDATE`, taskID).Scan(&title); err != nil {
		return nil, err
	}
	var id int64
	err = tx.QueryRow(`SELECT conversation_id FROM conversation_task_links WHERE task_id=$1`, taskID).Scan(&id)
	if err == sql.ErrNoRows {
		titleRunes := []rune(title)
		if len(titleRunes) > 100 {
			title = string(titleRunes[:100])
		}
		if err = tx.QueryRow(`INSERT INTO conversations(agent_key,title) VALUES('mainagent',$1) RETURNING id`, title).Scan(&id); err != nil {
			return nil, err
		}
		if _, err = tx.Exec(`INSERT INTO conversation_task_links(conversation_id,task_id) VALUES($1,$2)`, id, taskID); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return d.GetConversation(id)
}

// TaskConversationContext returns the bounded creation-time history snapshot.
// Main-agent chat consumes it too; planner/worker already receive it in Description.
func (d *DB) TaskConversationContext(taskID int64) (string, error) {
	var text string
	err := d.QueryRow(`SELECT context_snapshot FROM conversation_task_links WHERE task_id=$1`, taskID).Scan(&text)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return text, err
}
func (d *DB) TouchTaskConversation(taskID int64) error {
	_, err := d.Exec(`UPDATE conversations SET updated_at=now() WHERE id=(SELECT conversation_id FROM conversation_task_links WHERE task_id=$1)`, taskID)
	return err
}
