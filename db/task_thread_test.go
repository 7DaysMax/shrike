package db

import (
	"errors"
	"strings"
	"sync"
	"testing"
)

func TestWorkConversationBinding(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	c, err := d.CreateConversation("mainagent", "fusion test", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer d.DeleteConversation(c.ID)
	_, err = d.AppendConvActivity(c.ID, Activity{Kind: "user", Summary: "先讨论", Detail: "CONTEXT_SENTINEL 上传路径 /tmp/fixture.txt"})
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	var tasks []*Task
	var duplicates []*TaskBindingExistsError
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			task, e := d.CreateTaskWithOptions("THREAD_FUSION_FIXTURE", "验证会话绑定", TaskCreateOptions{ConversationID: &c.ID})
			mu.Lock()
			defer mu.Unlock()
			if e == nil {
				tasks = append(tasks, task)
				return
			}
			var bound *TaskBindingExistsError
			if !errors.As(e, &bound) {
				t.Error(e)
			} else {
				duplicates = append(duplicates, bound)
			}
		}()
	}
	wg.Wait()
	if len(tasks) != 1 || len(duplicates) != 3 {
		t.Fatalf("created=%d duplicate=%d", len(tasks), len(duplicates))
	}
	task := tasks[0]
	defer d.DeleteTask(task.ID)
	for _, b := range duplicates {
		if b.TaskID != task.ID {
			t.Fatal("retry changed task")
		}
	}
	if !strings.Contains(task.Description, "CONTEXT_SENTINEL") {
		t.Fatal("conversation context missing from execution input")
	}
	snapshot, err := d.TaskConversationContext(task.ID)
	if err != nil || !strings.Contains(snapshot, "CONTEXT_SENTINEL") {
		t.Fatalf("main-agent snapshot missing: %v", err)
	}
	if err := d.TouchTaskConversation(task.ID); err != nil {
		t.Fatal(err)
	}
	got, err := d.GetConversation(c.ID)
	if err != nil || got.TaskID == nil || *got.TaskID != task.ID {
		t.Fatalf("binding=%+v err=%v", got, err)
	}
	got, err = d.TaskConversation(task.ID)
	if err != nil || got.ID != c.ID {
		t.Fatalf("legacy entry made another thread: %+v %v", got, err)
	}
	if err = d.DeleteConversation(c.ID); err != nil {
		t.Fatal(err)
	}
	surviving, err := d.GetTask(task.ID)
	if err != nil || surviving == nil {
		t.Fatalf("deleting conversation removed task: %v", err)
	}
	recreated, err := d.TaskConversation(task.ID)
	if err != nil || recreated.ID == c.ID {
		t.Fatalf("reopen task=%+v %v", recreated, err)
	}
	defer d.DeleteConversation(recreated.ID)
	t.Log("PASS: 4 concurrent creates -> 1 task; context persisted; legacy entry reused; conversation deletion preserved task; reopen restored link")
}
func TestModelBrandPersistence(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	p := &LLMProfile{Name: "brand fixture", Format: "openai", Model: "renamed-model", APIKey: "fixture-secret", Brand: "deepseek", Streaming: true}
	id, err := d.SaveProfile(p)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Exec(`DELETE FROM llm_profiles WHERE id=$1`, id)
	got, err := d.ProfileByID(id)
	if err != nil || got.Brand != "deepseek" {
		t.Fatalf("insert brand=%+v %v", got, err)
	}
	got.Brand = "qwen"
	got.APIKey = ""
	if _, err = d.SaveProfile(got); err != nil {
		t.Fatal(err)
	}
	got, err = d.ProfileByID(id)
	if err != nil || got.Brand != "qwen" || got.APIKey != "fixture-secret" {
		t.Fatalf("no-key update failed: %v", err)
	}
	got.Brand = "glm"
	got.APIKey = "new-fixture-secret"
	if _, err = d.SaveProfile(got); err != nil {
		t.Fatal(err)
	}
	got, err = d.ProfileByID(id)
	if err != nil || got.Brand != "glm" || got.APIKey != "new-fixture-secret" {
		t.Fatalf("key update failed: %v", err)
	}
	profiles, err := d.ListProfiles()
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, x := range profiles {
		if x.ID == id {
			found = x.Brand == "glm" && x.APIKey == ""
		}
	}
	if !found {
		t.Fatal("list brand/key serialization")
	}
	t.Log("PASS: explicit brand persisted through insert and both key update branches; list keeps API key private")
}
