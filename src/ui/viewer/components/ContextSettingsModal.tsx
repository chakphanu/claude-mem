import React, { useState, useCallback, useEffect } from 'react';
import type { Settings } from '../types';
import { TerminalPreview } from './TerminalPreview';
import { useContextPreview } from '../hooks/useContextPreview';

interface ContextSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  onSave: (settings: Settings) => void;
  isSaving: boolean;
  saveStatus: string;
}

// Collapsible section component
function CollapsibleSection({
  title,
  description,
  children,
  defaultOpen = true
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`settings-section-collapsible ${isOpen ? 'open' : ''}`}>
      <button
        className="section-header-btn"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <div className="section-header-content">
          <span className="section-title">{title}</span>
          {description && <span className="section-description">{description}</span>}
        </div>
        <svg
          className={`chevron-icon ${isOpen ? 'rotated' : ''}`}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {isOpen && <div className="section-content">{children}</div>}
    </div>
  );
}

// Chip group with select all/none
function ChipGroup({
  label,
  options,
  selectedValues,
  onToggle,
  onSelectAll,
  onSelectNone
}: {
  label: string;
  options: string[];
  selectedValues: string[];
  onToggle: (value: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}) {
  const allSelected = options.every(opt => selectedValues.includes(opt));
  const noneSelected = options.every(opt => !selectedValues.includes(opt));

  return (
    <div className="chip-group">
      <div className="chip-group-header">
        <span className="chip-group-label">{label}</span>
        <div className="chip-group-actions">
          <button
            type="button"
            className={`chip-action ${allSelected ? 'active' : ''}`}
            onClick={onSelectAll}
          >
            All
          </button>
          <button
            type="button"
            className={`chip-action ${noneSelected ? 'active' : ''}`}
            onClick={onSelectNone}
          >
            None
          </button>
        </div>
      </div>
      <div className="chips-container">
        {options.map(option => (
          <button
            key={option}
            type="button"
            className={`chip ${selectedValues.includes(option) ? 'selected' : ''}`}
            onClick={() => onToggle(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

// Form field with optional tooltip
function FormField({
  label,
  tooltip,
  children
}: {
  label: string;
  tooltip?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="form-field">
      <label className="form-field-label">
        {label}
        {tooltip && (
          <span className="tooltip-trigger" title={tooltip}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

// Toggle switch component
function ToggleSwitch({
  id,
  label,
  description,
  checked,
  onChange,
  disabled
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="toggle-row">
      <div className="toggle-info">
        <label htmlFor={id} className="toggle-label">{label}</label>
        {description && <span className="toggle-description">{description}</span>}
      </div>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        className={`toggle-switch ${checked ? 'on' : ''} ${disabled ? 'disabled' : ''}`}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
      >
        <span className="toggle-knob" />
      </button>
    </div>
  );
}

// OpenAI Compatible settings component with model listing
function OpenAICompatibleSettings({
  formState,
  updateSetting
}: {
  formState: Settings;
  updateSetting: (key: keyof Settings, value: string) => void;
}) {
  const [models, setModels] = useState<Array<{ id: string; owned_by?: string }>>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const fetchModels = useCallback(async () => {
    const url = formState.CLAUDE_MEM_OPENAI_COMPATIBLE_URL;
    const apiKey = formState.CLAUDE_MEM_OPENAI_COMPATIBLE_API_KEY;

    if (!url) {
      setModelsError('Please enter the API URL first');
      return;
    }

    setIsLoadingModels(true);
    setModelsError(null);
    try {
      const params = new URLSearchParams({ url });
      if (apiKey) {
        params.append('apiKey', apiKey);
      }
      const response = await fetch(`/api/openai-compatible/models?${params}`);
      const data = await response.json();
      if (data.success && data.models) {
        setModels(data.models);
      } else {
        setModelsError(data.error || 'Failed to fetch models');
      }
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : 'Failed to fetch models');
    } finally {
      setIsLoadingModels(false);
    }
  }, [formState.CLAUDE_MEM_OPENAI_COMPATIBLE_URL, formState.CLAUDE_MEM_OPENAI_COMPATIBLE_API_KEY]);

  return (
    <>
      <FormField
        label="API URL"
        tooltip="Base URL for OpenAI-compatible API (e.g., http://localhost:11434/v1 for Ollama)"
      >
        <input
          type="text"
          value={formState.CLAUDE_MEM_OPENAI_COMPATIBLE_URL || ''}
          onChange={(e) => updateSetting('CLAUDE_MEM_OPENAI_COMPATIBLE_URL', e.target.value)}
          placeholder="http://localhost:11434/v1"
        />
      </FormField>
      <FormField
        label="API Key"
        tooltip="API key (optional for local servers like Ollama)"
      >
        <input
          type="password"
          value={formState.CLAUDE_MEM_OPENAI_COMPATIBLE_API_KEY || ''}
          onChange={(e) => updateSetting('CLAUDE_MEM_OPENAI_COMPATIBLE_API_KEY', e.target.value)}
          placeholder="Enter API key (optional)..."
        />
      </FormField>
      <FormField
        label="Model"
        tooltip="Model name from your API"
      >
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {models.length > 0 ? (
            <select
              value={formState.CLAUDE_MEM_OPENAI_COMPATIBLE_MODEL || ''}
              onChange={(e) => updateSetting('CLAUDE_MEM_OPENAI_COMPATIBLE_MODEL', e.target.value)}
              style={{ flex: 1 }}
            >
              <option value="">-- Select a model --</option>
              {models.map(model => (
                <option key={model.id} value={model.id}>
                  {model.owned_by ? `${model.id} (${model.owned_by})` : model.id}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={formState.CLAUDE_MEM_OPENAI_COMPATIBLE_MODEL || ''}
              onChange={(e) => updateSetting('CLAUDE_MEM_OPENAI_COMPATIBLE_MODEL', e.target.value)}
              placeholder="e.g., llama3.2, gpt-4o"
              style={{ flex: 1 }}
            />
          )}
          <button
            type="button"
            onClick={fetchModels}
            disabled={isLoadingModels || !formState.CLAUDE_MEM_OPENAI_COMPATIBLE_URL}
            title={!formState.CLAUDE_MEM_OPENAI_COMPATIBLE_URL ? 'Enter API URL first' : 'Fetch available models'}
            style={{
              padding: '8px 12px',
              border: '1px solid var(--border-color, #444)',
              borderRadius: '4px',
              background: 'var(--button-bg, #333)',
              color: 'var(--text-color, #fff)',
              cursor: isLoadingModels || !formState.CLAUDE_MEM_OPENAI_COMPATIBLE_URL ? 'not-allowed' : 'pointer',
              opacity: isLoadingModels || !formState.CLAUDE_MEM_OPENAI_COMPATIBLE_URL ? 0.5 : 1,
              whiteSpace: 'nowrap'
            }}
          >
            {isLoadingModels ? '...' : 'Fetch'}
          </button>
        </div>
        {modelsError && (
          <span style={{ color: '#ff6b6b', fontSize: '12px', marginTop: '4px', display: 'block' }}>
            {modelsError}
          </span>
        )}
        {models.length > 0 && !modelsError && (
          <span style={{ color: '#4ade80', fontSize: '12px', marginTop: '4px', display: 'block' }}>
            Found {models.length} models - select from dropdown
          </span>
        )}
      </FormField>
    </>
  );
}

export function ContextSettingsModal({
  isOpen,
  onClose,
  settings,
  onSave,
  isSaving,
  saveStatus
}: ContextSettingsModalProps) {
  const [formState, setFormState] = useState<Settings>(settings);

  // Update form state when settings prop changes
  useEffect(() => {
    setFormState(settings);
  }, [settings]);

  // Get context preview based on current form state
  const { preview, isLoading, error, projects, selectedProject, setSelectedProject } = useContextPreview(formState);

  const updateSetting = useCallback((key: keyof Settings, value: string) => {
    const newState = { ...formState, [key]: value };
    setFormState(newState);
  }, [formState]);

  const handleSave = useCallback(() => {
    onSave(formState);
  }, [formState, onSave]);

  const toggleBoolean = useCallback((key: keyof Settings) => {
    const currentValue = formState[key];
    const newValue = currentValue === 'true' ? 'false' : 'true';
    updateSetting(key, newValue);
  }, [formState, updateSetting]);

  const toggleArrayValue = useCallback((key: keyof Settings, value: string) => {
    const currentValue = formState[key] || '';
    const currentArray = currentValue ? currentValue.split(',') : [];
    const newArray = currentArray.includes(value)
      ? currentArray.filter(v => v !== value)
      : [...currentArray, value];
    updateSetting(key, newArray.join(','));
  }, [formState, updateSetting]);

  const getArrayValues = useCallback((key: keyof Settings): string[] => {
    const currentValue = formState[key] || '';
    return currentValue ? currentValue.split(',') : [];
  }, [formState]);

  const setAllArrayValues = useCallback((key: keyof Settings, values: string[]) => {
    updateSetting(key, values.join(','));
  }, [updateSetting]);

  // Handle ESC key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEsc);
      return () => window.removeEventListener('keydown', handleEsc);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const observationTypes = ['bugfix', 'feature', 'refactor', 'discovery', 'decision', 'change'];
  const observationConcepts = ['how-it-works', 'why-it-exists', 'what-changed', 'problem-solution', 'gotcha', 'pattern', 'trade-off'];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="context-settings-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <h2>Settings</h2>
          <div className="header-controls">
            <label className="preview-selector">
              Preview for:
              <select
                value={selectedProject || ''}
                onChange={(e) => setSelectedProject(e.target.value)}
              >
                {projects.map(project => (
                  <option key={project} value={project}>{project}</option>
                ))}
              </select>
            </label>
            <button
              onClick={onClose}
              className="modal-close-btn"
              title="Close (Esc)"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body - 2 columns */}
        <div className="modal-body">
          {/* Left column - Terminal Preview */}
          <div className="preview-column">
            <div className="preview-content">
              {error ? (
                <div style={{ color: '#ff6b6b' }}>
                  Error loading preview: {error}
                </div>
              ) : (
                <TerminalPreview content={preview} isLoading={isLoading} />
              )}
            </div>
          </div>

          {/* Right column - Settings Panel */}
          <div className="settings-column">
            {/* Section 1: Loading */}
            <CollapsibleSection
              title="Loading"
              description="How many observations to inject"
            >
              <FormField
                label="Observations"
                tooltip="Number of recent observations to include in context (1-200)"
              >
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={formState.CLAUDE_MEM_CONTEXT_OBSERVATIONS || '50'}
                  onChange={(e) => updateSetting('CLAUDE_MEM_CONTEXT_OBSERVATIONS', e.target.value)}
                />
              </FormField>
              <FormField
                label="Sessions"
                tooltip="Number of recent sessions to pull observations from (1-50)"
              >
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={formState.CLAUDE_MEM_CONTEXT_SESSION_COUNT || '10'}
                  onChange={(e) => updateSetting('CLAUDE_MEM_CONTEXT_SESSION_COUNT', e.target.value)}
                />
              </FormField>
            </CollapsibleSection>

            {/* Section 2: Filters */}
            <CollapsibleSection
              title="Filters"
              description="Which observation types to include"
            >
              <ChipGroup
                label="Type"
                options={observationTypes}
                selectedValues={getArrayValues('CLAUDE_MEM_CONTEXT_OBSERVATION_TYPES')}
                onToggle={(value) => toggleArrayValue('CLAUDE_MEM_CONTEXT_OBSERVATION_TYPES', value)}
                onSelectAll={() => setAllArrayValues('CLAUDE_MEM_CONTEXT_OBSERVATION_TYPES', observationTypes)}
                onSelectNone={() => setAllArrayValues('CLAUDE_MEM_CONTEXT_OBSERVATION_TYPES', [])}
              />
              <ChipGroup
                label="Concept"
                options={observationConcepts}
                selectedValues={getArrayValues('CLAUDE_MEM_CONTEXT_OBSERVATION_CONCEPTS')}
                onToggle={(value) => toggleArrayValue('CLAUDE_MEM_CONTEXT_OBSERVATION_CONCEPTS', value)}
                onSelectAll={() => setAllArrayValues('CLAUDE_MEM_CONTEXT_OBSERVATION_CONCEPTS', observationConcepts)}
                onSelectNone={() => setAllArrayValues('CLAUDE_MEM_CONTEXT_OBSERVATION_CONCEPTS', [])}
              />
            </CollapsibleSection>

            {/* Section 3: Display */}
            <CollapsibleSection
              title="Display"
              description="What to show in context tables"
            >
              <div className="display-subsection">
                <span className="subsection-label">Full Observations</span>
                <FormField
                  label="Count"
                  tooltip="How many observations show expanded details (0-20)"
                >
                  <input
                    type="number"
                    min="0"
                    max="20"
                    value={formState.CLAUDE_MEM_CONTEXT_FULL_COUNT || '5'}
                    onChange={(e) => updateSetting('CLAUDE_MEM_CONTEXT_FULL_COUNT', e.target.value)}
                  />
                </FormField>
                <FormField
                  label="Field"
                  tooltip="Which field to expand for full observations"
                >
                  <select
                    value={formState.CLAUDE_MEM_CONTEXT_FULL_FIELD || 'narrative'}
                    onChange={(e) => updateSetting('CLAUDE_MEM_CONTEXT_FULL_FIELD', e.target.value)}
                  >
                    <option value="narrative">Narrative</option>
                    <option value="facts">Facts</option>
                  </select>
                </FormField>
              </div>

              <div className="display-subsection">
                <span className="subsection-label">Token Economics</span>
                <div className="toggle-group">
                  <ToggleSwitch
                    id="show-read-tokens"
                    label="Read cost"
                    description="Tokens to read this observation"
                    checked={formState.CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS === 'true'}
                    onChange={() => toggleBoolean('CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS')}
                  />
                  <ToggleSwitch
                    id="show-work-tokens"
                    label="Work investment"
                    description="Tokens spent creating this observation"
                    checked={formState.CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS === 'true'}
                    onChange={() => toggleBoolean('CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS')}
                  />
                  <ToggleSwitch
                    id="show-savings-amount"
                    label="Savings"
                    description="Total tokens saved by reusing context"
                    checked={formState.CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT === 'true'}
                    onChange={() => toggleBoolean('CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT')}
                  />
                </div>
              </div>
            </CollapsibleSection>

            {/* Section 4: Advanced */}
            <CollapsibleSection
              title="Advanced"
              description="AI provider and model selection"
              defaultOpen={false}
            >
              <FormField
                label="AI Provider"
                tooltip="Choose between Claude (via Agent SDK), Gemini, OpenRouter, or any OpenAI-compatible API"
              >
                <select
                  value={formState.CLAUDE_MEM_PROVIDER || 'claude'}
                  onChange={(e) => updateSetting('CLAUDE_MEM_PROVIDER', e.target.value)}
                >
                  <option value="claude">Claude (uses your Claude account)</option>
                  <option value="gemini">Gemini (uses API key)</option>
                  <option value="openrouter">OpenRouter (multi-model)</option>
                  <option value="openai-compatible">OpenAI Compatible (custom endpoint)</option>
                </select>
              </FormField>

              {formState.CLAUDE_MEM_PROVIDER === 'claude' && (
                <FormField
                  label="Claude Model"
                  tooltip="Claude model used for generating observations"
                >
                  <select
                    value={formState.CLAUDE_MEM_MODEL || 'haiku'}
                    onChange={(e) => updateSetting('CLAUDE_MEM_MODEL', e.target.value)}
                  >
                    <option value="haiku">haiku (fastest)</option>
                    <option value="sonnet">sonnet (balanced)</option>
                    <option value="opus">opus (highest quality)</option>
                  </select>
                </FormField>
              )}

              {formState.CLAUDE_MEM_PROVIDER === 'gemini' && (
                <>
                  <FormField
                    label="Gemini API Key"
                    tooltip="Your Google AI Studio API key (or set GEMINI_API_KEY env var)"
                  >
                    <input
                      type="password"
                      value={formState.CLAUDE_MEM_GEMINI_API_KEY || ''}
                      onChange={(e) => updateSetting('CLAUDE_MEM_GEMINI_API_KEY', e.target.value)}
                      placeholder="Enter Gemini API key..."
                    />
                  </FormField>
                  <FormField
                    label="Gemini Model"
                    tooltip="Gemini model used for generating observations"
                  >
                    <select
                      value={formState.CLAUDE_MEM_GEMINI_MODEL || 'gemini-2.5-flash-lite'}
                      onChange={(e) => updateSetting('CLAUDE_MEM_GEMINI_MODEL', e.target.value)}
                    >
                      <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite (10 RPM free)</option>
                      <option value="gemini-2.5-flash">gemini-2.5-flash (5 RPM free)</option>
                      <option value="gemini-3-flash">gemini-3-flash (5 RPM free)</option>
                    </select>
                  </FormField>
                  <div className="toggle-group" style={{ marginTop: '8px' }}>
                    <ToggleSwitch
                      id="gemini-rate-limiting"
                      label="Rate Limiting"
                      description="Enable for free tier (10-30 RPM). Disable if you have billing set up (1000+ RPM)."
                      checked={formState.CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED === 'true'}
                      onChange={(checked) => updateSetting('CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED', checked ? 'true' : 'false')}
                    />
                  </div>
                </>
              )}

              {formState.CLAUDE_MEM_PROVIDER === 'openrouter' && (
                <>
                  <FormField
                    label="OpenRouter API Key"
                    tooltip="Your OpenRouter API key from openrouter.ai (or set OPENROUTER_API_KEY env var)"
                  >
                    <input
                      type="password"
                      value={formState.CLAUDE_MEM_OPENROUTER_API_KEY || ''}
                      onChange={(e) => updateSetting('CLAUDE_MEM_OPENROUTER_API_KEY', e.target.value)}
                      placeholder="Enter OpenRouter API key..."
                    />
                  </FormField>
                  <FormField
                    label="OpenRouter Model"
                    tooltip="Model identifier from OpenRouter (e.g., anthropic/claude-3.5-sonnet, google/gemini-2.0-flash-thinking-exp)"
                  >
                    <input
                      type="text"
                      value={formState.CLAUDE_MEM_OPENROUTER_MODEL || 'xiaomi/mimo-v2-flash:free'}
                      onChange={(e) => updateSetting('CLAUDE_MEM_OPENROUTER_MODEL', e.target.value)}
                      placeholder="e.g., xiaomi/mimo-v2-flash:free"
                    />
                  </FormField>
                  <FormField
                    label="Site URL (Optional)"
                    tooltip="Your site URL for OpenRouter analytics (optional)"
                  >
                    <input
                      type="text"
                      value={formState.CLAUDE_MEM_OPENROUTER_SITE_URL || ''}
                      onChange={(e) => updateSetting('CLAUDE_MEM_OPENROUTER_SITE_URL', e.target.value)}
                      placeholder="https://yoursite.com"
                    />
                  </FormField>
                  <FormField
                    label="App Name (Optional)"
                    tooltip="Your app name for OpenRouter analytics (optional)"
                  >
                    <input
                      type="text"
                      value={formState.CLAUDE_MEM_OPENROUTER_APP_NAME || 'claude-mem'}
                      onChange={(e) => updateSetting('CLAUDE_MEM_OPENROUTER_APP_NAME', e.target.value)}
                      placeholder="claude-mem"
                    />
                  </FormField>
                </>
              )}

              {formState.CLAUDE_MEM_PROVIDER === 'openai-compatible' && (
                <OpenAICompatibleSettings
                  formState={formState}
                  updateSetting={updateSetting}
                />
              )}

              <FormField
                label="Worker Port"
                tooltip="Port for the background worker service"
              >
                <input
                  type="number"
                  min="1024"
                  max="65535"
                  value={formState.CLAUDE_MEM_WORKER_PORT || '37777'}
                  onChange={(e) => updateSetting('CLAUDE_MEM_WORKER_PORT', e.target.value)}
                />
              </FormField>

              <FormField
                label="Max Memory (MB)"
                tooltip="Maximum RAM usage for the worker service (256-8192 MB). Requires worker restart to take effect."
              >
                <input
                  type="number"
                  min="256"
                  max="8192"
                  value={formState.CLAUDE_MEM_MAX_MEMORY_MB || '1024'}
                  onChange={(e) => updateSetting('CLAUDE_MEM_MAX_MEMORY_MB', e.target.value)}
                />
              </FormField>

              <div className="toggle-group" style={{ marginTop: '12px' }}>
                <ToggleSwitch
                  id="show-last-summary"
                  label="Include last summary"
                  description="Add previous session's summary to context"
                  checked={formState.CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY === 'true'}
                  onChange={() => toggleBoolean('CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY')}
                />
                <ToggleSwitch
                  id="show-last-message"
                  label="Include last message"
                  description="Add previous session's final message"
                  checked={formState.CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE === 'true'}
                  onChange={() => toggleBoolean('CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE')}
                />
              </div>
            </CollapsibleSection>
          </div>
        </div>

        {/* Footer with Save button */}
        <div className="modal-footer">
          <div className="save-status">
            {saveStatus && <span className={saveStatus.includes('✓') ? 'success' : saveStatus.includes('✗') ? 'error' : ''}>{saveStatus}</span>}
          </div>
          <button
            className="save-btn"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
