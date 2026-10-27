package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

// Scope-local inference choices never mutate shared provider profiles.
type UIInference struct {
	ProfileID       *int64 `json:"profile_id"`
	ExplicitModel   bool   `json:"explicit_model"`
	ThinkingType    string `json:"thinking_type"`
	ReasoningEffort string `json:"reasoning_effort"`
}

func (d *DB) UIInference(scope string, id int64) (UIInference, error) {
	var out UIInference
	var body []byte
	e := d.QueryRow(`SELECT config FROM ui_inference WHERE scope=$1 AND owner_id=$2`, scope, id).Scan(&body)
	if e == sql.ErrNoRows {
		return out, nil
	}
	if e != nil {
		return out, e
	}
	e = json.Unmarshal(body, &out)
	return out, e
}
func saveUIInferenceTx(tx *sql.Tx, scope string, id int64, value UIInference) error {
	if scope != "task" && scope != "conversation" {
		return fmt.Errorf("invalid inference scope")
	}
	body, e := json.Marshal(value)
	if e != nil {
		return e
	}
	_, e = tx.Exec(`INSERT INTO ui_inference(scope,owner_id,config)VALUES($1,$2,$3) ON CONFLICT(scope,owner_id)DO UPDATE SET config=excluded.config,updated_at=now()`, scope, id, body)
	return e
}
func (d *DB) SaveUIInference(scope string, id int64, value UIInference) error {
	tx, e := d.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if e = saveUIInferenceTx(tx, scope, id, value); e != nil {
		return e
	}
	return tx.Commit()
}

func (d *DB) SaveConversationInference(id int64, value UIInference) error {
	tx, e := d.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var found int64
	if e = tx.QueryRow(`SELECT id FROM conversations WHERE id=$1 FOR UPDATE`, id).Scan(&found); e != nil {
		return e
	}
	if e = lockLLMProfileForReference(tx, value.ProfileID); e != nil {
		return e
	}
	if _, e = tx.Exec(`UPDATE conversations SET llm_profile_id=$2,updated_at=now()WHERE id=$1`, id, value.ProfileID); e != nil {
		return e
	}
	if e = saveUIInferenceTx(tx, "conversation", id, value); e != nil {
		return e
	}
	return tx.Commit()
}
