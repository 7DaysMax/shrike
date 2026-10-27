package db

import (
	"testing"
)

func TestUIInferenceScopedPersistenceAndTaskCreation(t *testing.T) {
	d, e := Open(testDSN(t))
	if e != nil {
		t.Fatal(e)
	}
	defer d.Close()
	c, e := d.CreateConversation("mainagent", "inference fixture", nil)
	if e != nil {
		t.Fatal(e)
	}
	defer d.DeleteConversation(c.ID)
	want := UIInference{ThinkingType: "enabled", ReasoningEffort: "max"}
	if e = d.SaveUIInference("conversation", c.ID, want); e != nil {
		t.Fatal(e)
	}
	task, e := d.CreateTaskWithOptions("UI inference fixture", "local test", TaskCreateOptions{Inference: &want})
	if e != nil {
		t.Fatal(e)
	}
	defer d.DeleteTask(task.ID)
	for _, owner := range []struct {
		scope string
		id    int64
	}{{"task", task.ID}, {"conversation", c.ID}} {
		got, e := d.UIInference(owner.scope, owner.id)
		if e != nil || got.ReasoningEffort != "max" {
			t.Fatal(owner, got, e)
		}
	}
	other, e := d.UIInference("conversation", -1)
	if e != nil || other.ReasoningEffort != "" {
		t.Fatal("cross-scope leak", other, e)
	}
}
func TestUIInferenceTaskChainAtomicRollback(t *testing.T) {
	d, e := Open(testDSN(t))
	if e != nil {
		t.Fatal(e)
	}
	defer d.Close()
	old := UIInference{ReasoningEffort: "low"}
	task, e := d.CreateTaskWithOptions("inference transaction fixture", "test", TaskCreateOptions{Inference: &old})
	if e != nil {
		t.Fatal(e)
	}
	defer d.DeleteTask(task.ID)
	next := UIInference{ReasoningEffort: "max", ExplicitModel: true}
	if e = d.ReplaceTaskLLMProfiles(task.ID, []int64{9223372036854775806}, 9223372036854775806, &next); e == nil {
		t.Fatal("missing profile accepted")
	}
	got, e := d.UIInference("task", task.ID)
	if e != nil || got.ReasoningEffort != "low" {
		t.Fatal("partial inference update", got, e)
	}
}
