"use client";

import { useState } from "react";
import { Clock, Calendar, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { addHours, setHours, setMinutes, addDays, nextMonday } from "date-fns";

interface SnoozePopoverProps {
  onSnooze: (snoozeUntilIso: string, reason?: string) => Promise<void>;
  disabled?: boolean;
}

export function SnoozePopover({ onSnooze, disabled }: SnoozePopoverProps) {
  const [open, setOpen] = useState(false);
  const [customDateTime, setCustomDateTime] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const handleApplyPreset = async (targetDate: Date, defaultReason: string) => {
    setLoading(true);
    try {
      await onSnooze(targetDate.toISOString(), reason.trim() || defaultReason);
      setOpen(false);
      setReason("");
      setCustomDateTime("");
    } finally {
      setLoading(false);
    }
  };

  const handleApplyCustom = async () => {
    if (!customDateTime) return;
    setLoading(true);
    try {
      const d = new Date(customDateTime);
      await onSnooze(d.toISOString(), reason.trim() || "Adiado manualmente");
      setOpen(false);
      setReason("");
      setCustomDateTime("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            className="h-8 text-xs gap-1.5 border-border hover:bg-accent"
          />
        }
      >
        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
        <span>Adiar</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3 space-y-3">
        <div className="flex items-center justify-between pb-1 border-b border-border">
          <span className="text-xs font-semibold text-foreground">Adiar Follow-up</span>
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
        </div>

        {/* Quick Presets */}
        <div className="grid grid-cols-1 gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="justify-start h-8 text-xs font-normal"
            disabled={loading}
            onClick={() => handleApplyPreset(addHours(new Date(), 1), "+1 hora")}
          >
            <Clock className="h-3.5 w-3.5 mr-2 text-primary" />
            + 1 hora
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="justify-start h-8 text-xs font-normal"
            disabled={loading}
            onClick={() => {
              const tomorrow = addDays(new Date(), 1);
              handleApplyPreset(setMinutes(setHours(tomorrow, 9), 0), "Amanhã às 09:00");
            }}
          >
            <Calendar className="h-3.5 w-3.5 mr-2 text-blue-500" />
            Amanhã (09:00)
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="justify-start h-8 text-xs font-normal"
            disabled={loading}
            onClick={() => {
              const monday = nextMonday(new Date());
              handleApplyPreset(setMinutes(setHours(monday, 9), 0), "Próxima segunda-feira às 09:00");
            }}
          >
            <Calendar className="h-3.5 w-3.5 mr-2 text-purple-500" />
            Próxima Segunda (09:00)
          </Button>
        </div>

        {/* Custom date/time picker */}
        <div className="space-y-1.5 pt-2 border-t border-border">
          <label className="text-[11px] font-medium text-muted-foreground">
            Data e Hora Personalizada
          </label>
          <div className="flex gap-1.5">
            <Input
              type="datetime-local"
              value={customDateTime}
              onChange={(e) => setCustomDateTime(e.target.value)}
              className="h-8 text-xs"
            />
            <Button
              size="sm"
              variant="secondary"
              className="h-8 px-2.5"
              disabled={!customDateTime || loading}
              onClick={handleApplyCustom}
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Optional reason */}
        <div className="space-y-1">
          <Input
            placeholder="Motivo (opcional)..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-7 text-[11px]"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
