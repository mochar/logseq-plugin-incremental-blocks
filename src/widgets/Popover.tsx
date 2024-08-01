import React, { useEffect, useRef, useState } from "react";
import DatePicker from "react-datepicker";
import { BlockEntity } from "@logseq/libs/dist/LSPlugin";
import Beta from "../algorithm/beta";
import IncrementalBlock from "../IncrementalBlock";

import "react-datepicker/dist/react-datepicker.css";
import { dateDiffInDays, todayMidnight } from "../utils";
import { betaFromMean } from "../algorithm/priority";
import { initialIntervalFromMean } from "../algorithm/scheduling";
import BetaGraph from "./BetaGraph";
import PrioritySlider from "./PrioritySlider";
import GLOBALS from "../globals";

export default function Popover({ block, slot }: { block: BlockEntity, slot: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [beta, setBeta] = useState<Beta>();
  const [dueDate, setDueDate] = useState<Date>();
  const [multiplier, setMultiplier] = useState<number>(2.);
  const [interval, setInterval] = useState<number>();
  const [schedule, setSchedule] = useState<number[]>([]);
  const [busy, setBusy] = useState<boolean>(false);

  useEffect(() => {
    // Set position above bar
    const div = top?.document.getElementById(slot);
    console.log('div', div);
    // if (!div) return;
    if (div) {
      const elemBoundingRect = div.getBoundingClientRect();
      ref.current!.style.top = `${elemBoundingRect.top - (ref.current?.clientHeight ?? 0) - 10}px`;
      ref.current!.style.left = `${elemBoundingRect.left}px`;
    }

    // Block properties
    const props = block.properties!;
    const ib = new IncrementalBlock(block.uuid, props);
    const beta = ib.beta ?? new Beta(1, 1);
    setBeta(beta);
    if (ib.dueDate) {
      setDueDate(ib.dueDate);
    } else {
      updatePriority(beta.mean);
    }
    if (ib.interval) setInterval(ib.interval);
    setMultiplier(ib.multiplier);

    // Schedule
    updateSchedule();
  }, [block]);

  useEffect(() => {
    updateSchedule();
  }, [multiplier, interval, dueDate]);

  function updateSchedule() {
    if (!dueDate || !interval) return;

    const today = todayMidnight();
    let diff = dateDiffInDays(today, dueDate);
    setSchedule([diff]);
    if (diff < 0) { // past due date
      return;
    }

    const schedule = [diff];
    const nPred = 4;
    let _interval = interval;
    for (let i=0; i < nPred; i++) {
      _interval = Math.ceil(_interval * multiplier);
      diff = diff + _interval;
      // schedule.push(diff);
      schedule.push(_interval);
    }
    setSchedule(schedule);

  }

  async function updatePriority(meanPriority: number) {
    setBusy(true);
    const ib = await IncrementalBlock.fromUuid(block.uuid);
    const beta = betaFromMean(meanPriority, ib.beta);
    await logseq.Editor.upsertBlockProperty(block.uuid, 'ib-a', beta.a);
    await logseq.Editor.upsertBlockProperty(block.uuid, 'ib-b', beta.b);
    setBeta(beta);

    // Update interval.
    // For now only the initial interval.
    // See topic_interval.ipynb
    if (ib.reps === 0) {
      const interval = initialIntervalFromMean(meanPriority);
      const due = new Date();
      due.setDate(due.getDate() + interval);
      await logseq.Editor.upsertBlockProperty(block.uuid, 'ib-due', due.getTime());
      await logseq.Editor.upsertBlockProperty(block.uuid, 'ib-interval', interval);
      await logseq.Editor.upsertBlockProperty(block.uuid, 'ib-reps', 0);
      setDueDate(due);
      setInterval(interval);
    }
    setBusy(false);
  }

  async function updateDueDate(date: Date | null) {
    if (date === null) return;
    setBusy(true);
    // Set the time of 'today' to midnight to only compare dates, not times
    date.setHours(0, 0, 0, 0);
    await logseq.Editor.upsertBlockProperty(block.uuid, 'ib-due', date.getTime());

    // Update queue
    const today = todayMidnight();
    const curIsToday = dueDate && dateDiffInDays(today, dueDate) == 0;
    const newIsToday = dateDiffInDays(today, date) == 0;
    if (curIsToday && !newIsToday) {
      GLOBALS.queue.remove(block.uuid);
    } else if (!curIsToday && newIsToday) {
      const ib = await IncrementalBlock.fromUuid(block.uuid);
      GLOBALS.queue.add(ib);
    }

    setDueDate(date);
    setBusy(false);
  }

  async function updateMultiplier(multiplier: number) {
    setBusy(true);
    if (!isFinite(multiplier)) multiplier = logseq.settings?.defaultMultiplier as number ?? 2.;
    await logseq.Editor.upsertBlockProperty(block.uuid, 'ib-multiplier', multiplier);
    setMultiplier(multiplier);
    setBusy(false);
  }

  const scheduleList = [];
  if (schedule.length > 0) {
    for (let i = 0; i < schedule.length-1; i++) {
      scheduleList.push(<span>{schedule[i]}d</span>);
      scheduleList.push(<span> →</span>)
    }
    scheduleList.push(<span>{schedule[schedule.length-1]}d</span>);
  }

  return (
    <div 
      ref={ref} 
      id="ib-popover" 
      style={{position: "fixed"}} 
      className="flex rounded-lg border bg-white shadow-md p-1 divide-x text-sm"
    >
      <form><fieldset disabled={busy}><div className="flex divide-x">
        <div className="p-2 py-0">
          <p className="font-semibold text-gray-90">Priority</p>
          <div className="border w-fit">
            {beta && <BetaGraph beta={beta} width={120} height={60}></BetaGraph>}
          </div>
          {beta && <PrioritySlider
            init={beta.mean}
            onChange={updatePriority}
          ></PrioritySlider>}
        </div>

        <div className="p-2 py-0">
          <p className="font-semibold text-gray-90">Schedule</p>
          <p>Due</p>
          <DatePicker
            className="border"
            selected={dueDate}
            onChange={(date) => updateDueDate(date)}
            minDate={new Date()}
            monthsShown={1}
            dateFormat="dd/MM/yyyy"
          />
          <p>Multiplier</p>
          <input 
            className="border" 
            type="number" 
            value={multiplier}
            onChange={(e) => updateMultiplier(parseFloat(e.target.value))}
            min="1" 
            max="5" 
            step="0.1"
          ></input>
          <div className="text-neutral-400 text-xs flex items-center">
            {scheduleList}
          </div>
        </div>
      </div></fieldset></form>
    </div>
  );
}